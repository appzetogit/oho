/**
 * Step 2 — load the exported Laravel JSON into MongoDB.
 *
 *   cd ~/apps/oho/Backend
 *   node migration/02-migrate.js --dry-run     # report only, writes nothing
 *   node migration/02-migrate.js               # for real
 *   node migration/02-migrate.js --wipe        # clear previously migrated docs first
 *
 * Every document keeps a `legacyId` so a row can be traced back to MySQL and so
 * re-running the script updates rather than duplicates.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const DATA_DIR = path.join(__dirname, '_data');
const DRY_RUN = process.argv.includes('--dry-run');
const WIPE = process.argv.includes('--wipe');

const MONGO_URI = process.env.MONGODB_URI;
const MONGO_DB = process.env.MONGODB_DB_NAME || 'appzeto_taxi';
if (!MONGO_URI) {
  console.error('MONGODB_URI is not set in Backend/.env');
  process.exit(1);
}

// ── helpers ──────────────────────────────────────────────────────────────────
const load = (table) => {
  const f = path.join(DATA_DIR, `${table}.json`);
  if (!fs.existsSync(f)) {
    console.warn(`  ! ${table}.json missing — treating as empty`);
    return [];
  }
  return JSON.parse(fs.readFileSync(f, 'utf8'));
};

const oid = () => new mongoose.Types.ObjectId();
const date = (v) => (v ? new Date(String(v).replace(' ', 'T') + 'Z') : null);
const num = (v, d = 0) => (v === null || v === undefined || v === '' ? d : Number(v) || d);
const bool = (v) => v === 1 || v === '1' || v === true;
const str = (v, d = '') => (v === null || v === undefined ? d : String(v).trim());

// Laravel stores mobiles inconsistently — normalise to bare national digits.
const normPhone = (raw) => {
  let p = str(raw).replace(/[^\d]/g, '');
  if (p.startsWith('91') && p.length === 12) p = p.slice(2);
  if (p.startsWith('0') && p.length === 11) p = p.slice(1);
  return p.length >= 6 ? p : '';
};

const genderMap = (g) => {
  const v = str(g).toLowerCase();
  if (v.startsWith('m')) return 'male';
  if (v.startsWith('f')) return 'female';
  if (v.startsWith('o')) return 'other';
  return '';
};

// Laravel payment_opt: 1=cash, 2=card, 3=wallet. Mongo only knows cash|online.
const paymentMap = (p) => (String(p) === '1' ? 'cash' : 'online');

/**
 * MySQL hands back zone boundaries as WKT (the export runs ST_AsText on the
 * geometry columns). Zone.js wants GeoJSON, so parse POLYGON / MULTIPOLYGON
 * into the {type, coordinates} shape. Returns undefined on anything unexpected
 * rather than storing a half-parsed boundary.
 */
const wktToGeoJson = (wkt) => {
  if (!wkt) return undefined;
  const text = wkt.trim().toUpperCase();
  const ring = (s) =>
    s
      .split(',')
      .map((pair) => pair.trim().split(/\s+/).map(Number))
      .filter((c) => c.length === 2 && c.every(Number.isFinite));

  try {
    if (text.startsWith('MULTIPOLYGON')) {
      const body = wkt.slice(wkt.indexOf('(') + 1, wkt.lastIndexOf(')'));
      const polys = body.match(/\(\([^)]*\)(?:\s*,\s*\([^)]*\))*\)/g) || [];
      const coordinates = polys.map((p) =>
        (p.match(/\(([^()]*)\)/g) || []).map((r) => ring(r.slice(1, -1))),
      );
      return coordinates.length ? { type: 'MultiPolygon', coordinates } : undefined;
    }
    if (text.startsWith('POLYGON')) {
      const rings = (wkt.match(/\(([^()]*)\)/g) || []).map((r) => ring(r.slice(1, -1)));
      return rings.length ? { type: 'Polygon', coordinates: rings } : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
};

/**
 * MySQL let the same mobile be registered many times; Mongo makes phone unique.
 * Rather than drop the extras (which would orphan their rides), pick one winner
 * per phone and point every duplicate's legacy id at it, so foreign keys still
 * resolve and the ride history lands on the surviving account.
 *
 * Winner = still active, then most recently used, then highest id.
 */
const pickWinners = (rows, phoneOf) => {
  const byPhone = new Map();
  for (const r of rows) {
    const p = phoneOf(r);
    if (!p) continue;
    if (!byPhone.has(p)) byPhone.set(p, []);
    byPhone.get(p).push(r);
  }

  const score = (r) =>
    Date.parse(r.last_login_at || r.updated_at || r.created_at || 0) || 0;

  const winnerOf = new Map(); // legacy id -> legacy id of the row that survives
  let merged = 0;

  for (const group of byPhone.values()) {
    const sorted = [...group].sort((a, b) => {
      const del = (a.deleted_at ? 1 : 0) - (b.deleted_at ? 1 : 0);
      if (del) return del;
      const t = score(b) - score(a);
      if (t) return t;
      return Number(b.id) - Number(a.id);
    });
    const win = String(sorted[0].id);
    for (const r of sorted) {
      winnerOf.set(String(r.id), win);
      if (String(r.id) !== win) merged++;
    }
  }
  return { winnerOf, merged };
};

const report = [];
const note = (line) => {
  report.push(line);
  console.log(line);
};
const warn = (line) => {
  report.push(`  ! ${line}`);
  console.warn(`  ! ${line}`);
};

// ── connect ──────────────────────────────────────────────────────────────────
await mongoose.connect(MONGO_URI, { dbName: MONGO_DB });
const db = mongoose.connection.db;
note(`Connected to ${MONGO_DB}${DRY_RUN ? '  [DRY RUN — nothing will be written]' : ''}\n`);

const MIGRATED = [
  'taxiservicelocations',
  'taxivehicles',
  'taxizones',
  'taxicancellationreasons',
  'taxiusers',
  'taxidrivers',
  'taxiowners',
  'taxiuserwallets',
  'wallettransactions',
  'taxirides',
];

if (WIPE && !DRY_RUN) {
  for (const c of MIGRATED) {
    const n = await db.collection(c).deleteMany({ legacyId: { $exists: true } });
    if (n.deletedCount) note(`wiped ${n.deletedCount} migrated docs from ${c}`);
  }
  note('');
}

// Upsert a batch keyed on legacyId, preserving the original timestamps.
const write = async (collection, docs) => {
  if (DRY_RUN || docs.length === 0) return docs.length;
  const ops = docs.map((d) => ({
    updateOne: { filter: { legacyId: d.legacyId }, update: { $set: d }, upsert: true },
  }));
  let written = 0;
  for (let i = 0; i < ops.length; i += 500) {
    try {
      const r = await db.collection(collection).bulkWrite(ops.slice(i, i + 500), { ordered: false });
      written += r.upsertedCount + r.matchedCount;  // matched covers modified
    } catch (e) {
      // Summarise instead of dumping the driver's multi-thousand-line error.
      const errs = e.writeErrors || e.result?.writeErrors || [];
      written += e.result?.upsertedCount ?? 0;
      const kinds = new Map();
      for (const w of errs) {
        const msg = (w.err?.errmsg || w.errmsg || String(w)).split(' dup key')[0];
        kinds.set(msg, (kinds.get(msg) || 0) + 1);
      }
      for (const [msg, n] of kinds) warn(`${collection}: ${n} rejected — ${msg}`);
      if (!errs.length) throw e;
    }
  }
  return written;
};

// legacy id -> new ObjectId, per entity
const map = {
  user: new Map(),
  driver: new Map(),
  owner: new Map(),
  vehicle: new Map(),
  location: new Map(),
  zone: new Map(),
};

// Reuse the ObjectId already in Mongo if this row was migrated before.
const seedMap = async (collection, target) => {
  const existing = await db
    .collection(collection)
    .find({ legacyId: { $exists: true } }, { projection: { legacyId: 1 } })
    .toArray();
  for (const d of existing) target.set(String(d.legacyId), d._id);
};

// ═══ 1. Reference data ═══════════════════════════════════════════════════════
note('── 1. Reference data ──');

await seedMap('taxiservicelocations', map.location);
const locations = load('service_locations').map((r) => {
  const _id = map.location.get(String(r.id)) || oid();
  map.location.set(String(r.id), _id);
  return {
    _id,
    legacyId: String(r.id),
    name: str(r.name),
    currency_code: str(r.currency_code, 'INR'),
    currency_symbol: str(r.currency_symbol, '₹'),
    timezone: str(r.timezone, 'Asia/Kolkata'),
    active: bool(r.active),
    createdAt: date(r.created_at) || new Date(),
    updatedAt: date(r.updated_at) || new Date(),
  };
});
note(`service locations : ${await write('taxiservicelocations', locations)}`);

await seedMap('taxivehicles', map.vehicle);
const vehicles = load('vehicle_types').map((r) => {
  const _id = map.vehicle.get(String(r.id)) || oid();
  map.vehicle.set(String(r.id), _id);
  return {
    _id,
    legacyId: String(r.id),
    name: str(r.name),
    short_description: str(r.short_description),
    description: str(r.description),
    capacity: num(r.capacity, 4),
    transport_type: str(r.trip_dispatch_type).toUpperCase() === 'DELIVERY' ? 'delivery' : 'taxi',
    icon: str(r.icon),
    active: bool(r.active),
    status: bool(r.active) ? 'active' : 'inactive',
    is_accept_share_ride: bool(r.is_accept_share_ride),
    createdAt: date(r.created_at) || new Date(),
    updatedAt: date(r.updated_at) || new Date(),
  };
});
note(`vehicle types     : ${await write('taxivehicles', vehicles)}`);

await seedMap('taxizones', map.zone);
const zones = load('zones').map((r) => {
  const _id = map.zone.get(String(r.id)) || oid();
  map.zone.set(String(r.id), _id);
  // Field names here must match Zone.js exactly, or the app silently ignores them.
  return {
    _id,
    legacyId: String(r.id),
    name: str(r.name),
    service_location_id: map.location.get(String(r.service_location_id)) || null,
    unit: str(r.unit, 'km'),
    boundary_mode: 'polygon',
    // MULTIPOLYGON arrives from MySQL as WKT text; convert to GeoJSON.
    geometry: wktToGeoJson(str(r.coordinates)),
    circle_center:
      num(r.lat) && num(r.lng)
        ? { type: 'Point', coordinates: [num(r.lng), num(r.lat)] }
        : undefined,
    maximum_distance_for_regular_rides: num(r.maximum_distance),
    maximum_distance_for_outstation_rides: num(r.maximum_outstation_distance),
    peak_zone_radius: num(r.peak_zone_radius),
    peak_zone_duration: num(r.peak_zone_duration),
    peak_zone_ride_count: num(r.peak_zone_ride_count),
    active: bool(r.active),
    status: bool(r.active) ? 'active' : 'inactive',
    createdAt: date(r.created_at) || new Date(),
    updatedAt: date(r.updated_at) || new Date(),
  };
});
note(`zones             : ${await write('taxizones', zones)}`);

const reasons = load('cancellation_reasons').map((r) => ({
  legacyId: String(r.id),
  reason: str(r.reason),
  user_type: str(r.user_type, 'user'),
  active: bool(r.active),
  createdAt: date(r.created_at) || new Date(),
  updatedAt: date(r.updated_at) || new Date(),
}));
note(`cancel reasons    : ${await write('taxicancellationreasons', reasons)}`);

// ═══ 2. People ═══════════════════════════════════════════════════════════════
note('\n── 2. People ──');

const rawUsers = load('users');
const rawDrivers = load('drivers');
const rawOwners = load('owners');

// In the Laravel schema a driver/owner ALSO has a row in `users`. Only the
// leftovers are genuine riders, so migrate those and let the rest come across
// as drivers/owners instead.
const driverUserIds = new Set(rawDrivers.map((d) => String(d.user_id)));
const ownerUserIds = new Set(rawOwners.map((o) => String(o.user_id)));
const usersById = new Map(rawUsers.map((u) => [String(u.id), u]));

await seedMap('taxiusers', map.user);

const riderRows = rawUsers.filter(
  (u) => !driverUserIds.has(String(u.id)) && !ownerUserIds.has(String(u.id)),
);
const { winnerOf: riderWinner, merged: ridersMerged } = pickWinners(riderRows, (u) =>
  normPhone(u.mobile),
);

const riders = [];
let skippedNoPhone = 0;

for (const u of riderRows) {
  const id = String(u.id);
  const phone = normPhone(u.mobile);
  if (!phone) {
    skippedNoPhone++;
    continue;
  }

  // A duplicate points at the surviving account instead of creating its own.
  const winner = riderWinner.get(id);
  if (winner !== id) {
    const winnerOid = map.user.get(winner) || oid();
    map.user.set(winner, winnerOid);
    map.user.set(id, winnerOid);
    continue;
  }

  const _id = map.user.get(id) || oid();
  map.user.set(id, _id);

  riders.push({
    _id,
    legacyId: id,
    name: str(u.name) || `User ${id}`,
    phone,
    countryCode: '+91',
    email: str(u.email).toLowerCase(),
    // Laravel bcrypt hashes ($2y$) verify fine under bcryptjs, so logins keep working.
    password: str(u.password) || undefined,
    profileImage: str(u.profile_picture),
    gender: genderMap(u.gender),
    referralCode: str(u.refferal_code),
    fcmTokenMobile: str(u.fcm_token),
    isVerified: bool(u.mobile_confirmed),
    isActive: bool(u.active),
    active: bool(u.active),
    role: 'USER',
    addresses: [],
    deletedAt: date(u.deleted_at),
    createdAt: date(u.created_at) || new Date(),
    updatedAt: date(u.updated_at) || new Date(),
  });
}
note(`riders            : ${await write('taxiusers', riders)}`);
if (skippedNoPhone) warn(`${skippedNoPhone} users skipped — no usable mobile number`);
if (ridersMerged) note(`  ${ridersMerged} duplicate rider rows merged into the surviving account`);

// second pass: referredBy, now that every rider has an ObjectId
if (!DRY_RUN) {
  const refOps = [];
  for (const u of rawUsers) {
    const self = map.user.get(String(u.id));
    const ref = u.referred_by ? map.user.get(String(u.referred_by)) : null;
    if (self && ref) {
      refOps.push({ updateOne: { filter: { _id: self }, update: { $set: { referredBy: ref } } } });
    }
  }
  if (refOps.length) {
    await db.collection('taxiusers').bulkWrite(refOps, { ordered: false });
    note(`referral links    : ${refOps.length}`);
  }
}

// ── owners ──
await seedMap('taxiowners', map.owner);

// Owner.email and Owner.mobile are both unique (and email is required), but the
// legacy rows have blanks and repeats in each. Merge on mobile the same way as
// riders, then hand anyone still missing a unique address an obviously-fake one
// so the account exists and can be fixed up in the admin panel.
const ownerMobileOf = (o) => normPhone(o.mobile) || normPhone(o.phone);
const { winnerOf: ownerWinner, merged: ownersMerged } = pickWinners(rawOwners, ownerMobileOf);

const usedOwnerEmails = new Set();
const owners = [];
let ownersPlaceholderEmail = 0;
let ownersNoMobile = 0;

for (const o of rawOwners) {
  const legacyId = String(o.id);
  const mobile = ownerMobileOf(o);
  if (!mobile) {
    ownersNoMobile++;
    continue;
  }

  const winner = ownerWinner.get(legacyId);
  if (winner !== legacyId) {
    const winnerOid = map.owner.get(winner) || oid();
    map.owner.set(winner, winnerOid);
    map.owner.set(legacyId, winnerOid);
    continue;
  }

  let email = str(o.email).toLowerCase();
  if (!email || usedOwnerEmails.has(email)) {
    email = `owner-${legacyId.slice(0, 8)}@legacy.ohoride.in`;
    ownersPlaceholderEmail++;
  }
  usedOwnerEmails.add(email);

  const _id = map.owner.get(legacyId) || oid();
  map.owner.set(legacyId, _id);

  owners.push({
    _id,
    legacyId,
    name: str(o.owner_name) || str(o.name) || `Owner ${o.id}`,
    company_name: str(o.company_name),
    email,
    mobile,
    password: str(o.password) || undefined,
    address: str(o.address),
    city: str(o.city),
    service_location_id: map.location.get(String(o.service_location_id)) || null,
    no_of_vehicles: num(o.no_of_vehicles),
    bank_name: str(o.bank_name),
    ifsc: str(o.ifsc),
    account_no: str(o.account_no),
    active: bool(o.active),
    approve: bool(o.approve),
    deletedAt: date(o.deleted_at),
    createdAt: date(o.created_at) || new Date(),
    updatedAt: date(o.updated_at) || new Date(),
  });
}
note(`owners            : ${await write('taxiowners', owners)}`);
if (ownersNoMobile) warn(`${ownersNoMobile} owners skipped — no usable mobile number`);
if (ownersMerged) note(`  ${ownersMerged} duplicate owner rows merged into the surviving account`);
if (ownersPlaceholderEmail) {
  warn(`${ownersPlaceholderEmail} owners given a placeholder @legacy.ohoride.in email (none on file)`);
}

// ── drivers ──
await seedMap('taxidrivers', map.driver);

const docsByDriver = new Map();
for (const d of load('driver_documents')) {
  const k = String(d.driver_id);
  if (!docsByDriver.has(k)) docsByDriver.set(k, []);
  docsByDriver.get(k).push(d);
}
const bankByDriver = new Map();
for (const b of load('driver_bank_infos')) {
  const k = String(b.driver_id);
  if (!bankByDriver.has(k)) bankByDriver.set(k, {});
  bankByDriver.get(k)[str(b.field_id)] = str(b.value);
}
// Despite the column name, driver_wallet.user_id holds drivers.id — verified
// against the export: all 247 rows match drivers.id, only 154 match users.id.
const dWalletByDriver = new Map(load('driver_wallet').map((w) => [String(w.user_id), w]));
const vehicleNameByLegacy = new Map(vehicles.map((v) => [String(v.legacyId), v.name]));

// drivers.vehicle_type is populated for only a handful of rows — the real link
// is the driver_vehicle_types join table. Prefer that, fall back to the column.
const vtByDriver = new Map();
for (const r of load('driver_vehicle_types')) {
  if (!vtByDriver.has(String(r.driver_id))) vtByDriver.set(String(r.driver_id), String(r.vehicle_type));
}

const driverPhoneOf = (d) =>
  normPhone(d.mobile) || normPhone((usersById.get(String(d.user_id)) || {}).mobile);
const { winnerOf: driverWinner, merged: driversMerged } = pickWinners(rawDrivers, driverPhoneOf);

// A merged duplicate's wallet has to be added to the survivor's, not dropped:
// it is the same person, and the balance is real money either way (a negative
// balance is cash they still owe). Summed per surviving account here so the
// migrated total matches MySQL exactly.
const walletByWinner = new Map();
for (const d of rawDrivers) {
  const winner = driverWinner.get(String(d.id));
  if (!winner) continue;
  const w = dWalletByDriver.get(String(d.id)) || {};
  const acc = walletByWinner.get(winner) || { balance: 0, totalAdded: 0, totalSpent: 0 };
  acc.balance += num(w.amount_balance);
  acc.totalAdded += num(w.amount_added);
  acc.totalSpent += num(w.amount_spent);
  walletByWinner.set(winner, acc);
}

const drivers = [];
let dSkipped = 0;

for (const d of rawDrivers) {
  const id = String(d.id);
  const u = usersById.get(String(d.user_id)) || {};

  const phone = driverPhoneOf(d);
  if (!phone) {
    dSkipped++;
    continue;
  }

  const winner = driverWinner.get(id);
  if (winner !== id) {
    const winnerOid = map.driver.get(winner) || oid();
    map.driver.set(winner, winnerOid);
    map.driver.set(id, winnerOid);
    continue;
  }

  const _id = map.driver.get(id) || oid();
  map.driver.set(id, _id);

  const wallet = walletByWinner.get(id) || { balance: 0, totalAdded: 0, totalSpent: 0 };
  const legacyVt = vtByDriver.get(id) || String(d.vehicle_type || '');
  const lat = num(u.current_lat, null);
  const lng = num(u.current_lng, null);

  drivers.push({
    _id,
    legacyId: id,
    name: str(d.name) || str(u.name) || `Driver ${id}`,
    phone,
    email: (str(d.email) || str(u.email)).toLowerCase(),
    password: str(u.password) || undefined,
    country: str(d.country, '+91'),
    gender: genderMap(d.gender),
    city: str(d.city),
    profileImage: str(u.profile_picture),
    profile_picture: str(u.profile_picture),

    owner_id: map.owner.get(String(d.owner_id)) || null,
    service_location_id: map.location.get(String(d.service_location_id)) || null,
    vehicleTypeId: map.vehicle.get(legacyVt) || null,
    vehicleType: str(vehicleNameByLegacy.get(legacyVt)).toLowerCase(),
    // car_makes / car_models are empty in the source, so the free-text columns win.
    vehicleMake: str(d.custom_make),
    vehicleModel: str(d.custom_model),
    vehicleNumber: str(d.car_number).toUpperCase(),
    vehicleColor: str(d.car_color),

    approve: bool(d.approve),
    status: bool(d.approve) ? 'approved' : 'pending',
    isOnline: bool(d.available),
    isOnRide: false,

    rating: num(u.rating),
    ratingCount: num(u.no_of_ratings),
    totalRatingScore: num(u.rating_total),

    wallet: {
      balance: wallet.balance,
      totalAdded: wallet.totalAdded,
      totalSpent: wallet.totalSpent,
    },
    bankDetails: bankByDriver.get(id) || {},
    documents: (docsByDriver.get(id) || []).map((doc) => ({
      legacyDocumentId: str(doc.document_id),
      imageUrl: str(doc.image),
      backImageUrl: str(doc.back_image),
      identifyNumber: str(doc.identify_number),
      expiryDate: date(doc.expiry_date),
      status: num(doc.document_status) === 1 ? 'approved' : 'pending',
    })),
    zoneId: map.zone.get(String(u.zone_id)) || null,
    location: lat && lng ? { type: 'Point', coordinates: [lng, lat] } : undefined,

    deletedAt: date(d.deleted_at),
    createdAt: date(d.created_at) || new Date(),
    updatedAt: date(d.updated_at) || new Date(),
  });
}
note(`drivers           : ${await write('taxidrivers', drivers)}`);
if (dSkipped) warn(`${dSkipped} drivers skipped — no usable mobile number`);
if (driversMerged) note(`  ${driversMerged} duplicate driver rows merged into the surviving account`);

// ═══ 3. Wallets ══════════════════════════════════════════════════════════════
note('\n── 3. Wallets ──');

const uHistByUser = new Map();
for (const h of load('user_wallet_history')) {
  const k = String(h.user_id);
  if (!uHistByUser.has(k)) uHistByUser.set(k, []);
  uHistByUser.get(k).push(h);
}

// UserWallet.userId is unique, and merged duplicate riders now share one id —
// so fold their wallets together rather than letting the second one collide.
const walletByUser = new Map();
let walletsCombined = 0;

for (const w of load('user_wallet')) {
  const userId = map.user.get(String(w.user_id));
  if (!userId) continue; // wallet belonged to a driver/owner row, not a rider

  const txns = (uHistByUser.get(String(w.user_id)) || []).map((h) => ({
    kind: bool(h.is_credit) ? 'credit' : 'debit',
    amount: Math.abs(num(h.amount)),
    title: str(h.remarks) || (bool(h.is_credit) ? 'Wallet credit' : 'Wallet debit'),
    referenceKey: str(h.transaction_id),
    createdAt: date(h.created_at) || new Date(),
  }));

  const key = String(userId);
  const existing = walletByUser.get(key);
  if (existing) {
    existing.balance += num(w.amount_balance);
    existing.transactions.push(...txns);
    walletsCombined++;
    continue;
  }

  walletByUser.set(key, {
    legacyId: String(w.id),
    userId,
    balance: num(w.amount_balance),
    transactions: txns,
    createdAt: date(w.created_at) || new Date(),
    updatedAt: date(w.updated_at) || new Date(),
  });
}

const userWallets = [...walletByUser.values()];
for (const w of userWallets) {
  w.transactions.sort((a, b) => a.createdAt - b.createdAt);
}
note(`user wallets      : ${await write('taxiuserwallets', userWallets)}`);
if (walletsCombined) note(`  ${walletsCombined} wallets folded into a merged rider's balance`);

const driverTxns = [];
for (const h of load('driver_wallet_history')) {
  // Same quirk as driver_wallet: user_id is really drivers.id.
  const driverId = map.driver.get(String(h.user_id));
  if (!driverId) continue;
  driverTxns.push({
    legacyId: String(h.id),
    driverId,
    type: bool(h.is_credit) ? 'credit' : 'debit',
    amount: Math.abs(num(h.amount)),
    description: str(h.remarks),
    metadata: {
      legacyRequestId: str(h.request_id),
      legacyTransactionId: str(h.transaction_id),
    },
    createdAt: date(h.created_at) || new Date(),
    updatedAt: date(h.updated_at) || new Date(),
  });
}
note(`driver wallet txns: ${await write('wallettransactions', driverTxns)}`);

// ═══ 4. Rides ════════════════════════════════════════════════════════════════
note('\n── 4. Rides ──');

const placesByReq = new Map(load('request_places').map((p) => [String(p.request_id), p]));
const billsByReq = new Map(load('request_bills').map((b) => [String(b.request_id), b]));
const ratingsByReq = new Map(load('request_ratings').map((r) => [String(r.request_id), r]));

// Laravel tracks trip progress as a pile of booleans; Mongo wants one enum.
const deriveStatus = (r) => {
  if (bool(r.is_cancelled)) return ['cancelled', 'cancelled'];
  if (bool(r.is_completed)) return ['completed', 'completed'];
  if (bool(r.is_trip_start)) return ['ongoing', 'started'];
  if (bool(r.is_driver_arrived)) return ['accepted', 'arrived'];
  if (bool(r.is_driver_started)) return ['accepted', 'arriving'];
  if (r.driver_id) return ['accepted', 'accepted'];
  return ['searching', 'searching'];
};

const rides = [];
let ridesNoUser = 0;
let ridesNoPlace = 0;

for (const r of load('requests')) {
  const userId = map.user.get(String(r.user_id));
  if (!userId) {
    ridesNoUser++;
    continue;
  }

  const p = placesByReq.get(String(r.id));
  if (!p) {
    ridesNoPlace++;
    continue;
  }
  const b = billsByReq.get(String(r.id)) || {};
  const rt = ratingsByReq.get(String(r.id));

  const [status, liveStatus] = deriveStatus(r);
  const fare = num(b.total_amount) || num(r.accepted_ride_fare) || num(r.request_eta_amount) || 0;
  const serviceType = bool(r.is_parcel) ? 'parcel' : bool(r.is_out_station) ? 'intercity' : 'ride';

  rides.push({
    legacyId: String(r.id),
    legacyRequestNumber: str(r.request_number),
    userId,
    driverId: r.driver_id ? map.driver.get(String(r.driver_id)) || null : null,
    serviceType,
    bookingSource: bool(r.web_booking) ? 'website' : 'app',
    status,
    liveStatus,

    // MySQL keeps lat/lng in separate columns; GeoJSON wants [lng, lat].
    pickupLocation: { type: 'Point', coordinates: [num(p.pick_lng), num(p.pick_lat)] },
    pickupAddress: str(p.pick_address),
    dropLocation: { type: 'Point', coordinates: [num(p.drop_lng), num(p.drop_lat)] },
    dropAddress: str(p.drop_address),

    fare,
    baseFare: num(b.base_price),
    commissionAmount: num(b.admin_commision),
    driverEarnings: num(b.driver_commision),
    paymentMethod: paymentMap(r.payment_opt),
    bookingMode: bool(r.is_bid_ride) ? 'bidding' : 'normal',
    otp: str(r.ride_otp).padStart(4, '0').slice(-4),

    estimatedDistanceMeters: Math.round(num(r.total_distance) * 1000),
    estimatedDurationMinutes: Math.round(num(r.total_time)),

    service_location_id: map.location.get(String(r.service_location_id)) || null,
    scheduledAt: bool(r.is_later) ? date(r.trip_start_time) : null,
    acceptedAt: date(r.accepted_at),
    arrivedAt: date(r.arrived_at),
    startedAt: date(r.trip_start_time),
    completedAt: date(r.completed_at),
    cancelledAt: date(r.cancelled_at),
    cancellationReason: str(r.custom_reason),

    feedback: rt ? { rating: num(rt.user_rating), comment: str(rt.comment) } : undefined,

    messages: [],
    createdAt: date(r.created_at) || new Date(),
    updatedAt: date(r.updated_at) || new Date(),
  });
}
note(`rides             : ${await write('taxirides', rides)}`);
if (ridesNoUser) warn(`${ridesNoUser} rides skipped — rider was not migrated`);
if (ridesNoPlace) warn(`${ridesNoPlace} rides skipped — no pickup/drop coordinates`);

// ── done ─────────────────────────────────────────────────────────────────────
note('\n── Summary ──');
note(DRY_RUN ? 'DRY RUN — nothing was written.' : 'Migration complete.');

if (!DRY_RUN) {
  for (const c of MIGRATED) {
    const total = await db.collection(c).countDocuments();
    const legacy = await db.collection(c).countDocuments({ legacyId: { $exists: true } });
    note(`${c.padEnd(26)} ${String(total).padStart(6)} docs  (${legacy} from MySQL)`);
  }
}

fs.writeFileSync(path.join(__dirname, '_report.txt'), report.join('\n'));
await mongoose.disconnect();
