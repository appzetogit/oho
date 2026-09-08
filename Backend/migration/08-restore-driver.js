/**
 * Restore a single migrated driver that has since been removed from Mongo.
 *
 *   cd ~/apps/oho/Backend
 *   node migration/08-restore-driver.js <legacyId> --dry-run
 *   node migration/08-restore-driver.js <legacyId>
 *
 * Re-running 02-migrate.js would also bring the row back, but it upserts every
 * migrated user, driver and ride, so any admin edit made since the import —
 * an approval, a corrected phone number — would be reverted to the MySQL value.
 * This rebuilds one driver with the same mapping and touches nothing else.
 *
 * Refuses to overwrite a driver that is already present.
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
const TARGET = process.argv.slice(2).find((a) => !a.startsWith('--'));

if (!TARGET) {
  console.error('usage: node migration/08-restore-driver.js <legacyId> [--dry-run]');
  process.exit(1);
}

const load = (t) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${t}.json`), 'utf8'));
const date = (v) => (v ? new Date(String(v).replace(' ', 'T') + 'Z') : null);
const num = (v, d = 0) => (v === null || v === undefined || v === '' ? d : Number(v) || d);
const bool = (v) => v === 1 || v === '1' || v === true;
const str = (v, d = '') => (v === null || v === undefined ? d : String(v).trim());
const mask = (p) => (p ? `${String(p).slice(0, 2)}****${String(p).slice(-2)}` : '(none)');

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

await mongoose.connect(process.env.MONGODB_URI, {
  dbName: process.env.MONGODB_DB_NAME || 'appzeto_taxi',
});
const db = mongoose.connection.db;
const coll = db.collection('taxidrivers');

const rawDrivers = load('drivers');
const rawUsers = load('users');
const usersById = new Map(rawUsers.map((u) => [String(u.id), u]));

const d = rawDrivers.find((x) => String(x.id) === String(TARGET));
if (!d) {
  console.error(`No driver with legacyId ${TARGET} in the export.`);
  process.exit(1);
}
const u = usersById.get(String(d.user_id)) || {};
const phone = normPhone(d.mobile) || normPhone(u.mobile);

console.log(`Restoring driver legacyId ${TARGET}${DRY_RUN ? '  [DRY RUN]' : ''}`);
console.log(`  phone ${mask(phone)} | approve ${d.approve} | source deleted_at ${d.deleted_at}`);

const already = await coll.findOne({ $or: [{ legacyId: String(TARGET) }, { phone }] });
if (already) {
  console.error(`\nRefusing to run: a driver with that legacyId or phone already exists (${already._id}).`);
  process.exit(1);
}

// ── resolve the references the same way the migration did ───────────────────
const refId = async (collection, legacyId) => {
  if (!legacyId) return null;
  const doc = await db.collection(collection).findOne({ legacyId: String(legacyId) }, { projection: { _id: 1 } });
  return doc?._id || null;
};

const vtByDriver = new Map(load('driver_vehicle_types').map((r) => [String(r.driver_id), String(r.vehicle_type)]));
const legacyVt = vtByDriver.get(String(TARGET)) || String(d.vehicle_type || '');
const vehicleDoc = legacyVt
  ? await db.collection('taxivehicles').findOne({ legacyId: legacyVt }, { projection: { _id: 1, name: 1 } })
  : null;

// wallet: sum every legacy row that merged onto this phone, as the migration does
const walletRows = new Map(load('driver_wallet').map((w) => [String(w.user_id), w]));
const samePhone = rawDrivers.filter((x) => (normPhone(x.mobile) || normPhone(usersById.get(String(x.user_id))?.mobile)) === phone);
const wallet = samePhone.reduce(
  (acc, x) => {
    const w = walletRows.get(String(x.id)) || {};
    acc.balance += num(w.amount_balance);
    acc.totalAdded += num(w.amount_added);
    acc.totalSpent += num(w.amount_spent);
    return acc;
  },
  { balance: 0, totalAdded: 0, totalSpent: 0 },
);

const bank = {};
for (const b of load('driver_bank_infos')) {
  if (String(b.driver_id) === String(TARGET)) bank[str(b.field_id)] = str(b.value);
}
const documents = load('driver_documents')
  .filter((doc) => String(doc.driver_id) === String(TARGET))
  .map((doc) => ({
    legacyDocumentId: str(doc.document_id),
    imageUrl: str(doc.image),
    backImageUrl: str(doc.back_image),
    identifyNumber: str(doc.identify_number),
    expiryDate: date(doc.expiry_date),
    status: num(doc.document_status) === 1 ? 'approved' : 'pending',
  }));

const lat = num(u.current_lat, null);
const lng = num(u.current_lng, null);

const doc = {
  legacyId: String(TARGET),
  name: str(d.name) || str(u.name) || `Driver ${TARGET}`,
  phone,
  email: (str(d.email) || str(u.email)).toLowerCase(),
  password: str(u.password) || undefined,
  country: str(d.country, '+91'),
  gender: genderMap(d.gender),
  city: str(d.city),
  profileImage: str(u.profile_picture),
  profile_picture: str(u.profile_picture),

  owner_id: await refId('taxiowners', d.owner_id),
  service_location_id: await refId('taxiservicelocations', d.service_location_id),
  vehicleTypeId: vehicleDoc?._id || null,
  vehicleType: str(vehicleDoc?.name).toLowerCase(),
  vehicleMake: str(d.custom_make),
  vehicleModel: str(d.custom_model),
  vehicleNumber: str(d.car_number).toUpperCase(),
  vehicleColor: str(d.car_color),

  approve: bool(d.approve),
  status: bool(d.approve) ? 'approved' : 'pending',
  isOnline: false,
  isOnRide: false,

  rating: num(u.rating),
  ratingCount: num(u.no_of_ratings),
  totalRatingScore: num(u.rating_total),

  wallet: { balance: wallet.balance, totalAdded: wallet.totalAdded, totalSpent: wallet.totalSpent },
  bankDetails: bank,
  documents,
  zoneId: await refId('taxizones', u.zone_id),
  location: lat && lng ? { type: 'Point', coordinates: [lng, lat] } : undefined,

  deletedAt: date(d.deleted_at),
  createdAt: date(d.created_at) || new Date(),
  updatedAt: new Date(),
};

// reward points, as phase 2 sets them
const rewardRow = load('reward_points').find((r) => String(r.user_id) === String(d.user_id));
if (rewardRow) {
  doc.rewardPoints = {
    balance: num(rewardRow.balance_reward_points),
    totalCollected: num(rewardRow.total_reward_points_collected) || num(rewardRow.points_added),
    totalSpent: num(rewardRow.points_spend),
  };
}

console.log('\n  rebuilt document:');
console.log('    vehicleType   :', doc.vehicleType || '(none)', '| number:', doc.vehicleNumber || '(none)');
console.log('    approve/status:', doc.approve, '/', doc.status);
console.log('    wallet balance:', doc.wallet.balance);
console.log('    documents     :', doc.documents.length);
console.log('    zone / owner  :', doc.zoneId ? 'linked' : 'none', '/', doc.owner_id ? 'linked' : 'none');
console.log('    createdAt     :', doc.createdAt);

if (DRY_RUN) {
  console.log('\nDRY RUN — nothing written.');
} else {
  const res = await coll.insertOne(doc);
  console.log('\nrestored as', String(res.insertedId));
  const check = await coll.countDocuments({ legacyId: String(TARGET) });
  console.log('verify: present in Mongo =', check === 1);
}

await mongoose.disconnect();
process.exit(0);
