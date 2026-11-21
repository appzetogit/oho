/**
 * How fresh are online drivers' GPS positions? Read-only, counts only.
 *
 *   node scripts/driverGpsFreshness.mjs
 *
 * Use it before switching on the stale-location rule
 * (DRIVER_LOCATION_MAX_AGE_MS in .env): it prints how many online, free
 * drivers would still get rides at 1, 3, 10 and 30 minutes, and the admin's
 * driver search radius. Prints no names, phones or positions.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../.env') });

await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB_NAME || 'appzeto_taxi' });
const db = mongoose.connection.db;
const drivers = db.collection('taxidrivers');

const now = Date.now();
const MIN = 60 * 1000;
const base = { isOnline: true, isOnRide: false, approve: true, deletedAt: null };
const since = (ms) => ({ locationUpdatedAt: { $gte: new Date(now - ms) } });

const [online, freeOnline, never, f1, f3, f10, f30, d1] = await Promise.all([
  drivers.countDocuments({ isOnline: true, deletedAt: null }),
  drivers.countDocuments(base),
  drivers.countDocuments({ ...base, locationUpdatedAt: null }),
  drivers.countDocuments({ ...base, ...since(MIN) }),
  drivers.countDocuments({ ...base, ...since(3 * MIN) }),
  drivers.countDocuments({ ...base, ...since(10 * MIN) }),
  drivers.countDocuments({ ...base, ...since(30 * MIN) }),
  drivers.countDocuments({ ...base, ...since(24 * 60 * MIN) }),
]);

const settings = await db.collection('taxiadminbusinesssettings')
  .findOne({ scope: 'default' }, { projection: { 'transport_ride.driver_search_radius': 1 } })
  .catch(() => null);

console.log(JSON.stringify({
  at: new Date(now).toISOString(),
  onlineDrivers: online,
  onlineAndFree: freeOnline,
  gpsUnderOneMinute: f1,
  gpsUnderThreeMinutes: f3,
  gpsUnderTenMinutes: f10,
  gpsUnderThirtyMinutes: f30,
  gpsOverThirtyMinutes: freeOnline - f30 - never,
  gpsOverOneDay: freeOnline - d1 - never,
  neverStamped: never,
  driverSearchRadiusKm: settings?.transport_ride?.driver_search_radius ?? '(not set: default 2)',
  staleRuleNow: process.env.DRIVER_LOCATION_MAX_AGE_MS || 'off',
}, null, 2));

await mongoose.disconnect();
