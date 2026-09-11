/**
 * Give every service location a map point.
 *
 *   node migration/12-backfill-service-location-coordinates.js --dry-run
 *   node migration/12-backfill-service-location-coordinates.js
 *
 * Driver onboarding resolves the chosen service location to coordinates and
 * then finds the zone under that point. With no coordinates it throws
 * "Unsupported service location: <name>" — which read like the name was the
 * problem, but "India" is a real, active location; it just has no point.
 *
 * None of the migrated locations have one, because MySQL's service_locations
 * table never stored latitude or longitude.
 *
 * Coordinates come from the best source available, in order:
 *   1. the centre of a zone that belongs to the location — real operating
 *      area, and the point is guaranteed to resolve back into that zone
 *   2. the well-known geographic centre of the named city, state or country
 * A location matching neither is reported and left alone rather than guessed.
 *
 * Locations that already have a point are not touched.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const DRY_RUN = process.argv.includes('--dry-run');

// Public geographic centres, [lng, lat]. Only used when no zone exists.
const KNOWN_CENTRES = {
  india: [78.9629, 20.5937],
  kolkata: [88.3639, 22.5726],
  odisha: [85.0985, 20.9517],
  'madhya pradesh': [78.6569, 22.9734],
  indore: [75.8577, 22.7196],
  balasore: [86.9335, 21.4934],
};

const hasPoint = (s) =>
  (Array.isArray(s.location?.coordinates) && s.location.coordinates.length === 2) ||
  (typeof s.latitude === 'number' && typeof s.longitude === 'number');

/** Average of a polygon's outer ring — a fine label point for a city zone. */
const centreOfGeometry = (geometry) => {
  if (!geometry?.coordinates) return null;
  const ring =
    geometry.type === 'Polygon'
      ? geometry.coordinates[0]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates[0]?.[0]
        : null;
  if (!Array.isArray(ring) || !ring.length) return null;
  const pts = ring.filter((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite));
  if (!pts.length) return null;
  const lng = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const lat = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  return [Number(lng.toFixed(6)), Number(lat.toFixed(6))];
};

await mongoose.connect(process.env.MONGODB_URI, {
  dbName: process.env.MONGODB_DB_NAME || 'appzeto_taxi',
});
const db = mongoose.connection.db;
const locations = await db.collection('taxiservicelocations').find({}).toArray();
const zones = await db.collection('taxizones').find({}).toArray();

console.log(`${locations.length} service locations, ${zones.length} zones\n`);

const ops = [];
for (const s of locations) {
  const label = String(s.name || s.service_location_name || s._id).padEnd(16);
  if (hasPoint(s)) {
    console.log(`  ${label} already has a point, left alone`);
    continue;
  }

  let point = null;
  let source = '';

  const zone = zones.find((z) => String(z.service_location_id) === String(s._id));
  if (zone) {
    point = zone.circle_center?.coordinates?.length === 2 ? zone.circle_center.coordinates : centreOfGeometry(zone.geometry);
    if (point) source = `centre of its zone "${zone.name}"`;
  }

  if (!point) {
    const known = KNOWN_CENTRES[String(s.name || s.service_location_name || '').trim().toLowerCase()];
    if (known) {
      point = known;
      source = 'known geographic centre (no zone)';
    }
  }

  if (!point) {
    console.log(`  ${label} NO SOURCE — no zone and not a known place, left alone`);
    continue;
  }

  const [lng, lat] = point;
  console.log(`  ${label} -> [${lat}, ${lng}]  from ${source}`);
  ops.push({
    updateOne: {
      filter: { _id: s._id },
      update: { $set: { latitude: lat, longitude: lng, location: { type: 'Point', coordinates: [lng, lat] } } },
    },
  });
}

console.log(`\n${ops.length} to update`);
if (DRY_RUN) {
  console.log('DRY RUN — nothing written.');
} else if (ops.length) {
  await db.collection('taxiservicelocations').bulkWrite(ops, { ordered: false });
  const missing = await db.collection('taxiservicelocations').countDocuments({ 'location.coordinates': { $exists: false } });
  console.log(`done — service locations still without a point: ${missing}`);
}

await mongoose.disconnect();
process.exit(0);
