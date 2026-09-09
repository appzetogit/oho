/**
 * Repair the migrated vehicle icons.
 *
 *   node migration/10-fix-vehicle-icons.js --dry-run
 *   node migration/10-fix-vehicle-icons.js
 *
 * Three problems, all from the same import:
 *
 *  - `icon` holds the bare Laravel filename ("jRrmh0Kz….webp") rather than a
 *    URL. The API hands that straight to the apps, which have nothing to
 *    resolve it against, so the Flutter client shows no vehicle marker at all.
 *  - `map_icon` and `image` were never written. The API falls back
 *    map_icon || icon || image, so everything leaned on the unusable `icon`.
 *  - The source's `icon_types_for` was dropped, leaving every vehicle on the
 *    schema default of 'car' — so a bike renders as a car.
 *
 * The files themselves came across with 03-copy-uploads.sh and are served from
 * /uploads/legacy/..., so this points the records at where they already live.
 * A filename with no matching file is left alone rather than pointed at a URL
 * that 404s.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const DRY_RUN = process.argv.includes('--dry-run');

const PUBLIC_BASE = (process.env.PUBLIC_BACKEND_URL || 'https://ohoride.in').replace(/\/$/, '');
const UPLOADS_ROOT = path.resolve(__dirname, '../uploads');
// Where 03-copy-uploads.sh put the Laravel storage tree.
const LEGACY_REL = 'legacy/uploads/types/images';

// The old app's labels do not all match the schema's enum.
const ICON_TYPE_MAP = {
  motor_bike: 'bike',
  motorbike: 'bike',
  bike: 'bike',
  auto: 'auto',
  car: 'car',
  premium: 'premium',
  suv: 'suv',
  truck: 'truck',
  luxary: 'Luxary',
  luxury: 'Luxary',
};

await mongoose.connect(process.env.MONGODB_URI, {
  dbName: process.env.MONGODB_DB_NAME || 'appzeto_taxi',
});
const db = mongoose.connection.db;
const coll = db.collection('taxivehicles');

// icon_types_for lives only in the export, not in Mongo.
let sourceById = new Map();
try {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '_data/vehicle_types.json'), 'utf8'));
  sourceById = new Map(raw.map((r) => [String(r.id), r]));
} catch {
  console.warn('  ! vehicle_types.json not readable — icon_types will be left as-is\n');
}

const vehicles = await coll.find({}).toArray();
console.log(`${vehicles.length} vehicle types\n`);

const ops = [];
let fixedIcons = 0;
let fixedTypes = 0;
let missingFiles = 0;

for (const v of vehicles) {
  const set = {};
  const current = String(v.icon || '').trim();

  // Only rewrite a bare filename; anything already absolute is left alone so
  // this is safe to re-run and does not clobber an icon uploaded since.
  if (current && !/^https?:\/\//i.test(current)) {
    const filename = current.replace(/^.*[\\/]/, '');
    const onDisk = path.join(UPLOADS_ROOT, LEGACY_REL, filename);
    if (fs.existsSync(onDisk)) {
      const url = `${PUBLIC_BASE}/uploads/${LEGACY_REL}/${filename}`;
      set.icon = url;
      set.map_icon = url;
      set.image = url;
      fixedIcons += 1;
    } else {
      // The file is gone — it is not in the Laravel storage either, so the
      // reference was already dead before the migration. Clear it rather than
      // leaving a bare filename the app will try to load as a URL and fail on;
      // an empty value lets the client fall back to its own placeholder.
      set.icon = '';
      set.map_icon = '';
      set.image = '';
      console.log(`  ! ${String(v.name).padEnd(16)} file missing (${filename}) — clearing the dead reference`);
      missingFiles += 1;
    }
  } else if (current && !String(v.map_icon || '').trim()) {
    // Already a URL but no marker icon — mirror it across.
    set.map_icon = current;
    fixedIcons += 1;
  }

  const legacy = sourceById.get(String(v.legacyId));
  const rawType = String(legacy?.icon_types_for || '').trim().toLowerCase();
  const mapped = ICON_TYPE_MAP[rawType];
  if (mapped && v.icon_types !== mapped) {
    set.icon_types = mapped;
    fixedTypes += 1;
  }

  if (Object.keys(set).length) {
    ops.push({ updateOne: { filter: { _id: v._id }, update: { $set: set } } });
    console.log(
      `  ${String(v.name).padEnd(16)} ${set.icon_types ? `type=${set.icon_types} ` : ''}${set.icon ? 'icon+map_icon -> URL' : set.map_icon ? 'map_icon mirrored' : ''}`,
    );
  } else {
    console.log(`  ${String(v.name).padEnd(16)} nothing to change`);
  }
}

console.log(`\n${ops.length} vehicles to update — ${fixedIcons} icons, ${fixedTypes} icon types, ${missingFiles} files missing`);

if (DRY_RUN) {
  console.log('\nDRY RUN — nothing written.');
} else if (ops.length) {
  await coll.bulkWrite(ops, { ordered: false });
  console.log('\nafter:');
  for (const v of await coll.find({}).toArray()) {
    console.log(`  ${String(v.name).padEnd(16)} ${String(v.icon_types).padEnd(8)} ${v.map_icon || '(no marker icon)'}`);
  }
}

await mongoose.disconnect();
process.exit(0);
