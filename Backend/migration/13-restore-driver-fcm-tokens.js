/**
 * Restore the drivers' FCM tokens the migration dropped.
 *
 *   node migration/13-restore-driver-fcm-tokens.js --dry-run
 *   node migration/13-restore-driver-fcm-tokens.js
 *
 * 02-migrate.js copied users.fcm_token onto riders but not onto drivers, so
 * 224 drivers who had a working token in the old system arrived with none and
 * could receive no push until they signed in to the new app again.
 *
 * Each candidate is checked with a Firebase dry-run send first — it validates
 * the token against this project without delivering anything — and only tokens
 * Firebase accepts are written. A driver who already has a token (from signing
 * in to the new app) is never overwritten. Merged duplicate accounts contribute
 * their most recently updated token.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const DRY_RUN = process.argv.includes('--dry-run');

const load = (t) => JSON.parse(fs.readFileSync(path.join(__dirname, '_data', `${t}.json`), 'utf8'));
const str = (v) => (v == null ? '' : String(v).trim());
const normPhone = (raw) => {
  let p = str(raw).replace(/[^\d]/g, '');
  if (p.startsWith('91') && p.length === 12) p = p.slice(2);
  if (p.startsWith('0') && p.length === 11) p = p.slice(1);
  return p.length >= 6 ? p : '';
};

await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB_NAME || 'appzeto_taxi' });
const db = mongoose.connection.db;
const { getFirebaseMessaging } = await import('../src/config/firebase.js');
const messaging = await getFirebaseMessaging();
if (!messaging) {
  console.error('Firebase messaging is not configured — cannot validate tokens, aborting.');
  process.exit(1);
}

// Best token per phone from the old data: most recently updated user row wins.
const users = new Map(load('users').map((u) => [str(u.id), u]));
const best = new Map();
for (const d of load('drivers')) {
  const u = users.get(str(d.user_id)) || {};
  const token = str(u.fcm_token);
  const phone = normPhone(d.mobile) || normPhone(u.mobile);
  if (!token || !phone) continue;
  const when = Date.parse(u.updated_at || d.updated_at || 0) || 0;
  const prev = best.get(phone);
  if (!prev || when > prev.when) best.set(phone, { token, when });
}

const empty = { $and: [{ $or: [{ fcmTokenMobile: { $in: [null, ''] } }, { fcmTokenMobile: { $exists: false } }] }] };
const drivers = await db.collection('taxidrivers').find({ deletedAt: null, ...empty }).project({ phone: 1, name: 1 }).toArray();

let valid = 0, invalid = 0, none = 0;
const reasons = new Map();
const ops = [];
for (const drv of drivers) {
  const found = best.get(str(drv.phone));
  if (!found) { none += 1; continue; }
  try {
    await messaging.send({ token: found.token, data: { probe: '1' } }, true); // dry run
    valid += 1;
    ops.push({ updateOne: { filter: { _id: drv._id, ...empty }, update: { $set: { fcmTokenMobile: found.token } } } });
  } catch (error) {
    invalid += 1;
    const code = error?.errorInfo?.code || error?.code || error.message;
    reasons.set(code, (reasons.get(code) || 0) + 1);
  }
}

console.log(`drivers with no token: ${drivers.length}`);
console.log(`  old token accepted by Firebase : ${valid}`);
console.log(`  old token rejected             : ${invalid}`);
for (const [code, n] of reasons) console.log(`      ${n} × ${code}`);
console.log(`  no old token to restore        : ${none}`);

if (DRY_RUN) console.log('\nDRY RUN — nothing written.');
else if (ops.length) {
  const r = await db.collection('taxidrivers').bulkWrite(ops, { ordered: false });
  console.log(`\nrestored ${r.modifiedCount} driver tokens`);
}

await mongoose.disconnect();
process.exit(0);
