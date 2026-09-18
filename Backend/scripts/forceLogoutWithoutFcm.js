/**
 * Sign out every rider and driver who has no FCM token saved, so they log in
 * again and the app registers one.
 *
 *   node scripts/forceLogoutWithoutFcm.js --dry-run
 *   node scripts/forceLogoutWithoutFcm.js
 *
 * Sets tokensValidAfter to now; authMiddleware then refuses any token issued
 * before it with 'jwt expired', which the apps already handle as "log in
 * again". A fresh login afterwards works normally, so this is a one-time
 * sign-out, not a loop. Drivers on a ride are skipped.
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const DRY_RUN = process.argv.includes('--dry-run');

const empty = (f) => ({ $or: [{ [f]: { $in: [null, ''] } }, { [f]: { $exists: false } }] });
const noToken = { $and: [empty('fcmTokenMobile'), empty('fcmTokenWeb')] };

await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB_NAME || 'appzeto_taxi' });
const db = mongoose.connection.db;

const targets = [
  ['riders', 'taxiusers', { deletedAt: null, ...noToken }],
  ['drivers', 'taxidrivers', { deletedAt: null, isOnRide: { $ne: true }, ...noToken }],
];

const now = new Date();
for (const [label, coll, filter] of targets) {
  const n = await db.collection(coll).countDocuments(filter);
  if (DRY_RUN) {
    console.log(`${label.padEnd(8)} would log out ${n}`);
  } else {
    const r = await db.collection(coll).updateMany(filter, { $set: { tokensValidAfter: now } });
    console.log(`${label.padEnd(8)} logged out ${r.modifiedCount}`);
  }
}
console.log(DRY_RUN ? '\nDRY RUN — nothing written.' : `\ncutoff: ${now.toISOString()}`);

await mongoose.disconnect();
process.exit(0);
