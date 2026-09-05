/**
 * Step 7 — find migrated documents the app cannot actually see.
 *
 *   cd ~/apps/oho/Backend && node migration/07-audit-types.js
 *
 * The migration writes through the native driver (bulkWrite) so it can preserve
 * original timestamps, which also means Mongoose never casts the values or
 * applies schema defaults. A field stored as boolean true where the schema says
 * Number, or a missing field the app filters on, leaves the row present in the
 * database but invisible to every query — exactly what happened to SetPrice
 * (active: true vs the app's `active: 1`, and no `status` at all).
 *
 * Reports, per collection, any migrated document whose value disagrees with the
 * schema's declared type, plus schema-defaulted fields the migration omitted.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MODELS = [
  ['../src/modules/taxi/admin/models/SetPrice.js', 'SetPrice'],
  ['../src/modules/taxi/admin/models/Vehicle.js', 'Vehicle'],
  ['../src/modules/taxi/driver/models/Zone.js', 'Zone'],
  ['../src/modules/taxi/admin/models/ServiceLocation.js', 'ServiceLocation'],
  ['../src/modules/taxi/admin/models/GoodsType.js', 'GoodsType'],
  ['../src/modules/taxi/admin/models/CancellationReason.js', 'CancellationReason'],
  ['../src/modules/taxi/admin/models/DriverNeededDocument.js', 'DriverNeededDocument'],
  ['../src/modules/taxi/admin/models/OnboardingScreen.js', 'OnboardingScreen'],
  ['../src/modules/taxi/admin/promotions/models/Banner.js', 'Banner'],
  ['../src/modules/taxi/admin/models/SubscriptionPlan.js', 'SubscriptionPlan'],
  ['../src/modules/taxi/admin/models/RentalPackageType.js', 'RentalPackageType'],
  ['../src/modules/taxi/admin/models/Owner.js', 'Owner'],
  ['../src/modules/taxi/driver/models/Driver.js', 'Driver'],
  ['../src/modules/taxi/user/models/User.js', 'User'],
  ['../src/modules/taxi/user/models/Ride.js', 'Ride'],
];

await mongoose.connect(process.env.MONGODB_URI, {
  dbName: process.env.MONGODB_DB_NAME || 'appzeto_taxi',
});
const db = mongoose.connection.db;

const typeOfValue = (v) => {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return 'Array';
  if (v instanceof Date) return 'Date';
  if (v instanceof mongoose.Types.ObjectId) return 'ObjectId';
  if (typeof v === 'boolean') return 'Boolean';
  if (typeof v === 'number') return 'Number';
  if (typeof v === 'string') return 'String';
  return 'Object';
};

// Only flag mismatches that actually break an equality query.
const compatible = (expected, actual) => {
  if (actual === 'null') return true;
  if (expected === actual) return true;
  if (expected === 'Mixed' || expected === 'Object') return true;
  if (expected === 'Array' && actual === 'Array') return true;
  // A Number schema holding a Boolean is the dangerous case: {x: 1} will not
  // match true, so the row silently drops out of every filter.
  return false;
};

let totalProblems = 0;

for (const [rel, label] of MODELS) {
  let Model;
  try {
    const mod = await import(rel);
    Model = Object.values(mod).find((v) => v?.prototype instanceof mongoose.Model || v?.modelName);
  } catch (e) {
    console.log(`${label.padEnd(22)} could not load: ${e.message.slice(0, 60)}`);
    continue;
  }
  if (!Model?.collection?.name) continue;

  const coll = db.collection(Model.collection.name);
  const migrated = await coll.countDocuments({ legacyId: { $exists: true } });
  if (migrated === 0) continue;

  const docs = await coll.find({ legacyId: { $exists: true } }).limit(500).toArray();
  const schema = Model.schema;

  const mismatches = new Map(); // field -> {expected, actual, count}
  const missingDefaults = new Map(); // field -> {default, count}

  for (const doc of docs) {
    for (const p of Object.keys(schema.paths)) {
      if (p === '_id' || p === '__v' || p.includes('.')) continue;
      const path_ = schema.paths[p];
      const expected = path_.instance || 'Mixed';
      const has = Object.prototype.hasOwnProperty.call(doc, p);

      if (!has) {
        // Only interesting when the app is likely to filter on it.
        const def = path_.options?.default;
        if (def !== undefined && def !== null && typeof def !== 'function' && ['active', 'status'].includes(p)) {
          const e = missingDefaults.get(p) || { default: def, count: 0 };
          e.count += 1;
          missingDefaults.set(p, e);
        }
        continue;
      }

      const actual = typeOfValue(doc[p]);
      if (!compatible(expected, actual)) {
        const key = `${p}`;
        const e = mismatches.get(key) || { expected, actual, count: 0 };
        e.count += 1;
        mismatches.set(key, e);
      }
    }
  }

  if (mismatches.size === 0 && missingDefaults.size === 0) {
    console.log(`${label.padEnd(22)} ${String(migrated).padStart(4)} migrated   OK`);
    continue;
  }

  console.log(`${label.padEnd(22)} ${String(migrated).padStart(4)} migrated   PROBLEMS:`);
  for (const [field, e] of mismatches) {
    totalProblems += 1;
    console.log(`    ${field.padEnd(26)} schema wants ${e.expected}, stored ${e.actual}  (${e.count} docs)`);
  }
  for (const [field, e] of missingDefaults) {
    totalProblems += 1;
    console.log(`    ${field.padEnd(26)} MISSING, schema default ${JSON.stringify(e.default)}  (${e.count} docs)`);
  }
}

console.log(`\n${totalProblems === 0 ? 'No type problems found.' : `${totalProblems} field-level problem(s) found.`}`);
await mongoose.disconnect();
