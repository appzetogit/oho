/**
 * Step 4 — post-migration sanity check. Aggregate counts only, no personal data.
 *
 *   cd ~/apps/oho/Backend && node migration/04-verify.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

await mongoose.connect(process.env.MONGODB_URI, {
  dbName: process.env.MONGODB_DB_NAME || 'appzeto_taxi',
});
const db = mongoose.connection.db;

const c = (name) => db.collection(name);
const p = (label, value) => console.log(`  ${label.padEnd(40)} ${value}`);
const group = async (coll, field) => {
  const rows = await c(coll)
    .aggregate([{ $group: { _id: `$${field}`, n: { $sum: 1 } } }, { $sort: { n: -1 } }])
    .toArray();
  return rows.map((r) => `${r._id ?? '(none)'}=${r.n}`).join('  ');
};

console.log('\n=== COUNTS ===');
for (const coll of [
  'taxiusers', 'taxidrivers', 'taxiowners', 'taxirides',
  'taxiuserwallets', 'wallettransactions',
  'taxivehicles', 'taxiservicelocations', 'taxizones', 'taxicancellationreasons',
]) {
  p(coll, await c(coll).countDocuments());
}

console.log('\n=== RIDERS ===');
p('with a bcrypt password hash', await c('taxiusers').countDocuments({ password: /^\$2/ }));
p('no password (OTP-only login)', await c('taxiusers').countDocuments({ password: { $in: [null, ''] } }));
p('verified', await c('taxiusers').countDocuments({ isVerified: true }));
p('soft-deleted', await c('taxiusers').countDocuments({ deletedAt: { $ne: null } }));
p('inactive', await c('taxiusers').countDocuments({ isActive: false }));
p('with an email', await c('taxiusers').countDocuments({ email: { $nin: [null, ''] } }));
p('with a referrer', await c('taxiusers').countDocuments({ referredBy: { $ne: null } }));
p('duplicate phones (must be 0)',
  (await c('taxiusers').aggregate([
    { $group: { _id: '$phone', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } },
  ]).toArray()).length);

console.log('\n=== DRIVERS ===');
p('with a bcrypt password hash', await c('taxidrivers').countDocuments({ password: /^\$2/ }));
p('approved', await c('taxidrivers').countDocuments({ approve: true }));
p('soft-deleted', await c('taxidrivers').countDocuments({ deletedAt: { $ne: null } }));
p('with vehicleTypeId linked', await c('taxidrivers').countDocuments({ vehicleTypeId: { $ne: null } }));
p('with a vehicle number', await c('taxidrivers').countDocuments({ vehicleNumber: { $nin: [null, ''] } }));
p('with >=1 document', await c('taxidrivers').countDocuments({ 'documents.0': { $exists: true } }));
p('with bank details', await c('taxidrivers').countDocuments({ bankDetails: { $nin: [null, {}] } }));
p('with wallet balance > 0', await c('taxidrivers').countDocuments({ 'wallet.balance': { $gt: 0 } }));
p('with a GPS location', await c('taxidrivers').countDocuments({ 'location.coordinates.0': { $exists: true } }));
p('by vehicleType', await group('taxidrivers', 'vehicleType'));

console.log('\n=== RIDES ===');
p('by status', await group('taxirides', 'status'));
p('by serviceType', await group('taxirides', 'serviceType'));
p('by paymentMethod', await group('taxirides', 'paymentMethod'));
p('with a driver assigned', await c('taxirides').countDocuments({ driverId: { $ne: null } }));
p('with rider feedback', await c('taxirides').countDocuments({ 'feedback.rating': { $gt: 0 } }));
p('pickup coords missing (want 0)', await c('taxirides').countDocuments({ 'pickupLocation.coordinates.0': 0 }));

const fares = await c('taxirides').aggregate([
  { $match: { status: 'completed' } },
  { $group: { _id: null, total: { $sum: '$fare' }, avg: { $avg: '$fare' }, max: { $max: '$fare' } } },
]).toArray();
if (fares[0]) {
  p('completed revenue', `₹${fares[0].total.toFixed(0)}`);
  p('average completed fare', `₹${fares[0].avg.toFixed(0)}`);
  p('highest completed fare', `₹${fares[0].max.toFixed(0)}`);
}

console.log('\n=== ORPHAN REFERENCE CHECK ===');
const orphan = async (coll, field, targetColl) => {
  const ids = await c(coll).distinct(field, { [field]: { $ne: null } });
  if (!ids.length) return 0;
  const found = await c(targetColl).countDocuments({ _id: { $in: ids } });
  return ids.length - found;
};
p('rides -> missing rider', await orphan('taxirides', 'userId', 'taxiusers'));
p('rides -> missing driver', await orphan('taxirides', 'driverId', 'taxidrivers'));
p('wallets -> missing rider', await orphan('taxiuserwallets', 'userId', 'taxiusers'));
p('wallet txns -> missing driver', await orphan('wallettransactions', 'driverId', 'taxidrivers'));
p('drivers -> missing owner', await orphan('taxidrivers', 'owner_id', 'taxiowners'));
p('drivers -> missing vehicle type', await orphan('taxidrivers', 'vehicleTypeId', 'taxivehicles'));

console.log();
await mongoose.disconnect();
