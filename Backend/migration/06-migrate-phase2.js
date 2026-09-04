/**
 * Step 6 — the tables phase 1 left behind: zone pricing, loyalty points, owner
 * wallets, cancellation fees, support chat and the remaining config.
 *
 *   cd ~/apps/oho/Backend
 *   node migration/06-migrate-phase2.js --dry-run
 *   node migration/06-migrate-phase2.js
 *
 * Depends on phase 1 having run: legacy ids are resolved by reading back the
 * `legacyId` already stored on the migrated users, drivers, owners and rides.
 *
 * Foreign keys in the source are not always what their name suggests. Verified
 * against the export before writing any of this:
 *   owner_wallets.user_id  -> owners.id   (NOT users.id)
 *   reward_points.user_id  -> users.id    (always a driver's user row)
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

const load = (t) => {
  const f = path.join(DATA_DIR, `${t}.json`);
  if (!fs.existsSync(f)) {
    console.warn(`  ! ${t}.json missing — treating as empty`);
    return [];
  }
  return JSON.parse(fs.readFileSync(f, 'utf8'));
};

const date = (v) => (v ? new Date(String(v).replace(' ', 'T') + 'Z') : null);
const num = (v, d = 0) => (v === null || v === undefined || v === '' ? d : Number(v) || d);
const bool = (v) => v === 1 || v === '1' || v === true;
const str = (v, d = '') => (v === null || v === undefined ? d : String(v).trim());

const report = [];
const note = (l) => { report.push(l); console.log(l); };
const warn = (l) => { report.push(`  ! ${l}`); console.warn(`  ! ${l}`); };

await mongoose.connect(process.env.MONGODB_URI, {
  dbName: process.env.MONGODB_DB_NAME || 'appzeto_taxi',
});
const db = mongoose.connection.db;
note(`Connected${DRY_RUN ? '  [DRY RUN — nothing will be written]' : ''}\n`);

const write = async (collection, docs) => {
  if (DRY_RUN || !docs.length) return docs.length;
  const ops = docs.map((d) => ({
    updateOne: { filter: { legacyId: d.legacyId }, update: { $set: d }, upsert: true },
  }));
  let n = 0;
  for (let i = 0; i < ops.length; i += 500) {
    try {
      const r = await db.collection(collection).bulkWrite(ops.slice(i, i + 500), { ordered: false });
      n += r.upsertedCount + r.matchedCount;  // matched covers modified
    } catch (e) {
      const errs = e.writeErrors || e.result?.writeErrors || [];
      n += e.result?.upsertedCount ?? 0;
      const kinds = new Map();
      for (const w of errs) {
        const m = (w.err?.errmsg || w.errmsg || String(w)).split(' dup key')[0];
        kinds.set(m, (kinds.get(m) || 0) + 1);
      }
      for (const [m, c] of kinds) warn(`${collection}: ${c} rejected — ${m}`);
      if (!errs.length) throw e;
    }
  }
  return n;
};

// ── rebuild the legacy-id -> ObjectId maps from what phase 1 wrote ───────────
const idMap = async (collection) => {
  const rows = await db
    .collection(collection)
    .find({ legacyId: { $exists: true } }, { projection: { legacyId: 1 } })
    .toArray();
  return new Map(rows.map((r) => [String(r.legacyId), r._id]));
};

const users = await idMap('taxiusers');
const drivers = await idMap('taxidrivers');
const owners = await idMap('taxiowners');
const rides = await idMap('taxirides');
const vehicles = await idMap('taxivehicles');
const zones = await idMap('taxizones');
note(`resolved: ${users.size} users, ${drivers.size} drivers, ${owners.size} owners, ${rides.size} rides\n`);

const rawDrivers = load('drivers');
const rawUsers = load('users');

const normPhone = (raw) => {
  let p = str(raw).replace(/[^\d]/g, '');
  if (p.startsWith('91') && p.length === 12) p = p.slice(2);
  if (p.startsWith('0') && p.length === 11) p = p.slice(1);
  return p.length >= 6 ? p : '';
};

/**
 * Phase 1 merged duplicate-phone drivers, so a legacy driver id may have no
 * document of its own. Resolve by phone instead: every legacy row — winner or
 * merged-away duplicate — lands on the account that actually survived.
 */
const usersById = new Map(rawUsers.map((u) => [String(u.id), u]));
const mongoDriverByPhone = new Map(
  (await db.collection('taxidrivers').find({}, { projection: { phone: 1 } }).toArray()).map((d) => [
    String(d.phone),
    d._id,
  ]),
);
const driverIdByLegacyUserId = new Map();
for (const d of rawDrivers) {
  const phone = normPhone(d.mobile) || normPhone((usersById.get(String(d.user_id)) || {}).mobile);
  const _id = mongoDriverByPhone.get(phone);
  if (_id) driverIdByLegacyUserId.set(String(d.user_id), _id);
}

// ═══ 1. Zone pricing ═════════════════════════════════════════════════════════
note('── 1. Zone pricing ──');

const priceByZoneType = new Map(load('zone_type_price').map((p) => [String(p.zone_type_id), p]));
const setPrices = load('zone_types').map((zt) => {
  const p = priceByZoneType.get(String(zt.id)) || {};
  return {
    legacyId: String(zt.id),
    zone_id: zones.get(String(zt.zone_id)) || null,
    vehicle_type: vehicles.get(String(zt.type_id)) || null,
    transport_type: str(zt.transport_type, 'taxi').toLowerCase(),
    pricing_scope: 'zone',
    payment_type: str(zt.payment_type),

    base_price: num(p.base_price),
    base_distance: num(p.base_distance),
    price_per_distance: num(p.price_per_distance),
    time_price: num(p.price_per_time),
    waiting_charge: num(p.waiting_charge),
    free_waiting_before: num(p.free_waiting_time_in_mins_before_trip_start),

    outstation_base_price: num(p.outstation_base_price),
    outstation_base_distance: num(p.outstation_base_distance),
    outstation_price_per_distance: num(p.outstation_price_per_distance),
    outstation_time_price: num(p.outstation_price_per_time),

    user_cancellation_fee: num(p.cancellation_fee_for_user) || num(p.cancellation_fee),
    driver_cancellation_fee: num(p.cancellation_fee_for_driver),
    cancellation_fee_goes_to: str(p.fee_goes_to),

    service_tax: num(zt.service_tax),
    driver_commission: num(zt.admin_commission_from_driver),
    driver_commission_type: str(zt.admin_commission_type_from_driver),
    owner_commission: num(zt.admin_commission_for_owner),
    owner_commission_type: str(zt.admin_commission_type_for_owner),
    customer_commission: num(zt.admin_commision),
    customer_commission_type: str(zt.admin_commision_type),

    active: bool(zt.active),
    createdAt: date(zt.created_at) || new Date(),
    updatedAt: date(zt.updated_at) || new Date(),
  };
});
note(`set prices        : ${await write('taxisetprices', setPrices)}`);

// ═══ 2. Loyalty points ═══════════════════════════════════════════════════════
note('\n── 2. Loyalty points ──');

// Points from merged duplicate accounts are summed onto the surviving driver
// rather than dropped — it's the same person twice.
const pointsByDriver = new Map();
let rewardsNoDriver = 0;
let rewardsCombined = 0;

for (const r of load('reward_points')) {
  const driverId = driverIdByLegacyUserId.get(String(r.user_id));
  if (!driverId) {
    rewardsNoDriver++;
    continue;
  }
  const k = String(driverId);
  const acc = pointsByDriver.get(k) || { driverId, balance: 0, totalCollected: 0, totalSpent: 0 };
  if (pointsByDriver.has(k)) rewardsCombined++;
  acc.balance += num(r.balance_reward_points);
  acc.totalCollected += num(r.total_reward_points_collected) || num(r.points_added);
  acc.totalSpent += num(r.points_spend);
  pointsByDriver.set(k, acc);
}

const rewardOps = [...pointsByDriver.values()].map((a) => ({
  updateOne: {
    filter: { _id: a.driverId },
    update: {
      $set: {
        rewardPoints: {
          balance: a.balance,
          totalCollected: a.totalCollected,
          totalSpent: a.totalSpent,
        },
      },
    },
  },
}));
if (!DRY_RUN && rewardOps.length) {
  await db.collection('taxidrivers').bulkWrite(rewardOps, { ordered: false });
}
note(`driver reward points: ${rewardOps.length}`);
if (rewardsCombined) note(`  ${rewardsCombined} duplicate-account point balances folded into the survivor`);
if (rewardsNoDriver) warn(`${rewardsNoDriver} reward rows skipped — no matching driver`);

// ═══ 3. Owner wallets ════════════════════════════════════════════════════════
note('\n── 3. Owner wallets ──');

const ownerBalanceOps = [];
const ownerTxns = [];
let ownerWalletsNoOwner = 0;

for (const w of load('owner_wallets')) {
  // Column is called user_id but holds owners.id — verified, 36/36.
  const ownerId = owners.get(String(w.user_id));
  if (!ownerId) {
    ownerWalletsNoOwner++;
    continue;
  }
  ownerBalanceOps.push({
    updateOne: {
      filter: { _id: ownerId },
      update: { $set: { 'wallet.balance': num(w.amount_balance) } },
    },
  });
  if (num(w.amount_added)) {
    ownerTxns.push({
      legacyId: `owner-wallet-${w.id}`,
      ownerId,
      kind: 'credit',
      amount: num(w.amount_added),
      title: 'Opening balance carried over from the previous system',
      balance: num(w.amount_balance),
      createdAt: date(w.created_at) || new Date(),
      updatedAt: date(w.updated_at) || new Date(),
    });
  }
}
if (!DRY_RUN && ownerBalanceOps.length) {
  await db.collection('taxiowners').bulkWrite(ownerBalanceOps, { ordered: false });
}
note(`owner balances    : ${ownerBalanceOps.length}`);
note(`owner wallet txns : ${await write('taxiownerwallettransactions', ownerTxns)}`);
if (ownerWalletsNoOwner) warn(`${ownerWalletsNoOwner} owner wallets skipped — owner not migrated`);

// ═══ 4. Cancellation fees ════════════════════════════════════════════════════
note('\n── 4. Cancellation fees charged ──');

const feeOps = [];
let feesNoRide = 0;
for (const f of load('request_cancellation_fees')) {
  const rideId = rides.get(String(f.request_id));
  if (!rideId) {
    feesNoRide++;
    continue;
  }
  feeOps.push({
    updateOne: {
      filter: { _id: rideId },
      update: {
        $set: {
          cancellationFee: {
            amount: num(f.cancellation_fee),
            chargedTo: f.driver_id ? 'driver' : 'user',
            isPaid: bool(f.is_paid),
          },
        },
      },
    },
  });
}
if (!DRY_RUN && feeOps.length) {
  await db.collection('taxirides').bulkWrite(feeOps, { ordered: false });
}
note(`ride cancellation fees: ${feeOps.length}`);
if (feesNoRide) warn(`${feesNoRide} fees skipped — ride not migrated`);

// ═══ 5. Support chat ═════════════════════════════════════════════════════════
note('\n── 5. Support chat ──');

const convById = new Map(load('conversations').map((c) => [String(c.id), c]));
const chatMsgs = [];
let msgsNoConv = 0;

for (const m of load('messages')) {
  const conv = convById.get(String(m.conversation_id));
  if (!conv) {
    msgsNoConv++;
    continue;
  }
  const userId = users.get(String(conv.user_id)) || null;
  const fromUser = str(m.sender_type).toLowerCase().includes('user');
  chatMsgs.push({
    legacyId: `msg-${m.id}`,
    channel: 'support',
    conversationKey: `legacy-conv-${conv.id}`,
    senderRole: fromUser ? 'user' : 'admin',
    senderId: fromUser ? userId : null,
    receiverRole: fromUser ? 'admin' : 'user',
    receiverId: fromUser ? null : userId,
    message: str(m.content),
    createdAt: date(m.created_at) || new Date(),
    updatedAt: date(m.updated_at) || new Date(),
  });
}
note(`support messages  : ${await write('taxisupportchatmessages', chatMsgs)}`);
if (msgsNoConv) warn(`${msgsNoConv} messages skipped — parent conversation missing`);

// ═══ 6. Config and content ═══════════════════════════════════════════════════
note('\n── 6. Config and content ──');

const goods = load('goods_types').map((g) => ({
  legacyId: String(g.id),
  goods_type_name: str(g.goods_type_name),
  translation_dataset: str(g.translation_dataset),
  goods_types_for: str(g.goods_types_for),
  company_key: str(g.company_key),
  active: bool(g.active),
  status: bool(g.active) ? 1 : 0,
  createdAt: date(g.created_at) || new Date(),
  updatedAt: date(g.updated_at) || new Date(),
}));
note(`goods types       : ${await write('taxigoodstypes', goods)}`);

// slug is unique on this model, so de-duplicate before writing.
const usedSlugs = new Set();
const needed = load('driver_needed_documents').map((d) => {
  let slug = str(d.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `doc-${d.id}`;
  if (usedSlugs.has(slug)) slug = `${slug}-${d.id}`;
  usedSlugs.add(slug);
  return {
  legacyId: String(d.id),
  name: str(d.name),
  slug,
  account_type: str(d.account_type, 'driver'),
  image_type: str(d.image_type),
  has_expiry_date: bool(d.has_expiry_date),
  has_identify_number: bool(d.has_identify_number),
  identify_number_key: str(d.identify_number_locale_key),
  front_key: str(d.document_name_front),
  back_key: str(d.document_name_back),
  is_editable: bool(d.is_editable),
  is_required: bool(d.is_required),
  active: bool(d.active),
  createdAt: date(d.created_at) || new Date(),
  updatedAt: date(d.updated_at) || new Date(),
  };
});
note(`needed documents  : ${await write('taxidriverneededdocuments', needed)}`);

const onboarding = load('onboarding_screen').map((o) => ({
  legacyId: String(o.id),
  audience: str(o.screen).toLowerCase().includes('driver') ? 'driver' : 'user',
  screen: str(o.screen),
  order: num(o.order) || num(o.sn_o),
  title: str(o.title),
  description: str(o.description),
  active: bool(o.active),
  createdAt: date(o.created_at) || new Date(),
  updatedAt: date(o.updated_at) || new Date(),
}));
note(`onboarding screens: ${await write('taxionboardingscreens', onboarding)}`);

const banners = load('banner_images').map((b) => ({
  legacyId: String(b.id),
  title: `Legacy banner ${b.id}`,
  image: str(b.image),
  link_type: 'none',
  active: bool(b.active),
  createdAt: date(b.created_at) || new Date(),
  updatedAt: date(b.updated_at) || new Date(),
}));
note(`banners           : ${await write('taxibanners', banners)}`);

const plans = load('subscriptions').map((s) => ({
  legacyId: String(s.id),
  audience: 'driver',
  name: str(s.name),
  description: str(s.description),
  amount: num(s.amount),
  duration: num(s.subscription_duration),
  vehicle_type_id: vehicles.get(String(s.vehicle_type_id)) || null,
  // No schema field for these two, but the Razorpay id is worth not losing.
  legacyBillingCycle: str(s.billing_cycle),
  legacyRazorpayPlanId: str(s.razorpay_plan_id),
  active: bool(s.active),
  createdAt: date(s.created_at) || new Date(),
  updatedAt: date(s.updated_at) || new Date(),
}));
note(`subscription plans: ${await write('taxisubscriptionplans', plans)}`);

const packages = load('package_types').map((p) => ({
  legacyId: String(p.id),
  name: str(p.name),
  short_description: str(p.short_description),
  description: str(p.description),
  transport_type: str(p.transport_type, 'taxi').toLowerCase(),
  active: bool(p.active),
  status: bool(p.active) ? 1 : 0,
  createdAt: date(p.created_at) || new Date(),
  updatedAt: date(p.updated_at) || new Date(),
}));
note(`rental packages   : ${await write('taxirentalpackagetypes', packages)}`);

const careers = load('career_applications').map((c) => ({
  legacyId: String(c.id),
  name: str(c.name),
  email: str(c.email).toLowerCase(),
  phone: str(c.phone) || str(c.mobile),
  message: str(c.message) || str(c.cover_letter),
  resumeUrl: str(c.resume) || str(c.file),
  createdAt: date(c.created_at) || new Date(),
  updatedAt: date(c.updated_at) || new Date(),
}));
note(`career apps       : ${await write('taxicareerapplications', careers)}`);

// ── vehicle sub-types fold into the parent vehicle ──
const subsByParent = new Map();
for (const s of load('sub_vehicle_types')) {
  const parent = vehicles.get(String(s.vehicle_type_id));
  const child = vehicles.get(String(s.sub_vehicle_type_id));
  if (!parent || !child) continue;
  const k = String(parent);
  if (!subsByParent.has(k)) subsByParent.set(k, { parent, children: [] });
  subsByParent.get(k).children.push(child);
}
if (!DRY_RUN && subsByParent.size) {
  await db.collection('taxivehicles').bulkWrite(
    [...subsByParent.values()].map((v) => ({
      updateOne: {
        filter: { _id: v.parent },
        update: { $set: { supported_other_vehicle_types: v.children } },
      },
    })),
    { ordered: false },
  );
}
note(`vehicle sub-types : ${subsByParent.size} parents linked`);

// ── rider saved places -> User.addresses ──
// Legacy rows hold a pickup AND drop pair; User.addresses is a single address,
// so only the pickup side survives. Flagged rather than silently halved.
const favOps = [];
for (const f of load('favourite_locations')) {
  const userId = users.get(String(f.user_id));
  if (!userId) continue;
  favOps.push({
    updateOne: {
      filter: { _id: userId },
      update: {
        $addToSet: {
          addresses: {
            label: 'Other',
            street: str(f.pick_address) || str(f.address_name) || 'Saved location',
            additionalDetails: str(f.landmark),
            city: '',
            state: '',
            location:
              num(f.pick_lat) && num(f.pick_lng)
                ? { type: 'Point', coordinates: [num(f.pick_lng), num(f.pick_lat)] }
                : undefined,
          },
        },
      },
    },
  });
}
if (!DRY_RUN && favOps.length) {
  await db.collection('taxiusers').bulkWrite(favOps, { ordered: false });
}
note(`saved places      : ${favOps.length} (drop-off half not carried — no field for it)`);

note('\n── Summary ──');
note(DRY_RUN ? 'DRY RUN — nothing was written.' : 'Phase 2 complete.');
if (!DRY_RUN) {
  for (const c of [
    'taxisetprices', 'taxiownerwallettransactions', 'taxisupportchatmessages',
    'taxigoodstypes', 'taxidriverneededdocuments', 'taxionboardingscreens',
    'taxibanners', 'taxisubscriptionplans', 'taxirentalpackagetypes',
    'taxicareerapplications',
  ]) {
    note(`${c.padEnd(30)} ${String(await db.collection(c).countDocuments()).padStart(5)} docs`);
  }
}

fs.writeFileSync(path.join(__dirname, '_report-phase2.txt'), report.join('\n'));
await mongoose.disconnect();
