import dotenv from 'dotenv';
import mongoose from 'mongoose';
dotenv.config();

await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB_NAME });
const db = mongoose.connection.db;

const { resolveSetPriceForRide } = await import('./src/modules/taxi/services/rideService.js');

const zone = await db.collection('taxizones').findOne({}, { projection: { name: 1 } });
const vehicles = await db.collection('taxivehicles').find({}, { projection: { name: 1 } }).toArray();

console.log('=== can the fare engine resolve a price per vehicle? ===');
console.log(`zone: ${zone?.name}\n`);

for (const v of vehicles) {
  const rule = await resolveSetPriceForRide({
    zoneId: zone?._id || null,
    vehicleTypeId: v._id,
    transportType: 'taxi',
  });
  if (!rule) {
    console.log(`  ${String(v.name).padEnd(16)} NO PRICING RULE`);
    continue;
  }
  console.log(
    `  ${String(v.name).padEnd(16)} base ₹${rule.base_price} for ${rule.base_distance}km, ` +
      `then ₹${rule.price_per_distance}/km, ₹${rule.time_price}/min` +
      (rule.price_per_distance < 0 ? '   <-- NEGATIVE per-km rate' : ''),
  );
}

await mongoose.disconnect();
