/**
 * Turn every leftover Laravel filename into a URL the apps can actually load.
 *
 *   node migration/11-fix-legacy-asset-urls.js --dry-run
 *   node migration/11-fix-legacy-asset-urls.js
 *
 * The migration copied MySQL's image columns verbatim, and Laravel stored only
 * a filename ("l0DgUwCt….png") because it resolved the path at render time.
 * Nothing here does, so every one of these reaches the apps as a relative
 * string they cannot resolve: broken banner thumbnails in the admin panel, no
 * vehicle markers in the Flutter app, missing driver documents.
 *
 * 03-copy-uploads.sh already brought the files across to uploads/legacy, so
 * this indexes what is actually on disk and rewrites each reference to point at
 * it. A filename with no matching file is cleared rather than left behind — an
 * empty value lets a client fall back to its own placeholder, where a bare
 * filename just fails to load.
 *
 * Safe to re-run: anything already absolute is left untouched.
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

// collection -> the fields that hold an image reference
const TARGETS = [
  { collection: 'taxibanners', fields: ['image'] },
  { collection: 'taxivehicles', fields: ['icon', 'map_icon', 'image'] },
  { collection: 'taxigoodstypes', fields: ['icon'] },
  { collection: 'taxiusers', fields: ['profileImage'] },
  { collection: 'taxidrivers', fields: ['profileImage', 'profile_picture'] },
  { collection: 'taxionboardingscreens', fields: ['image'] },
];

// Driver documents live in an array, so they need their own pass.
const ARRAY_TARGETS = [
  { collection: 'taxidrivers', arrayField: 'documents', fields: ['imageUrl', 'backImageUrl'] },
];

// ── index every file that actually exists under uploads/ ────────────────────
const byFilename = new Map();
const indexDir = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) indexDir(full);
    // First match wins; duplicates across folders are the same asset in practice.
    else if (!byFilename.has(entry.name)) byFilename.set(entry.name, full);
  }
};
indexDir(UPLOADS_ROOT);
console.log(`indexed ${byFilename.size} files under uploads/\n`);

const urlFor = (filename) => {
  const full = byFilename.get(filename);
  if (!full) return null;
  return `${PUBLIC_BASE}/uploads/${path.relative(UPLOADS_ROOT, full).split(path.sep).join('/')}`;
};

const isAbsolute = (v) => /^https?:\/\//i.test(String(v || ''));
const filenameOf = (v) => String(v || '').trim().replace(/^.*[\\/]/, '');

await mongoose.connect(process.env.MONGODB_URI, {
  dbName: process.env.MONGODB_DB_NAME || 'appzeto_taxi',
});
const db = mongoose.connection.db;

let totalFixed = 0;
let totalCleared = 0;
let totalSkipped = 0;

// ── plain fields ────────────────────────────────────────────────────────────
for (const { collection, fields } of TARGETS) {
  const coll = db.collection(collection);
  const docs = await coll.find({}).toArray();
  const ops = [];
  let fixed = 0;
  let cleared = 0;
  let already = 0;

  for (const doc of docs) {
    const set = {};
    for (const field of fields) {
      const value = doc[field];
      if (!value) continue;
      if (isAbsolute(value)) {
        already += 1;
        continue;
      }
      const url = urlFor(filenameOf(value));
      if (url) {
        set[field] = url;
        fixed += 1;
      } else {
        set[field] = '';
        cleared += 1;
      }
    }
    if (Object.keys(set).length) ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: set } } });
  }

  if (!DRY_RUN && ops.length) await coll.bulkWrite(ops, { ordered: false });
  console.log(
    `${collection.padEnd(24)} ${String(docs.length).padStart(4)} docs   ${fixed} rewritten, ${cleared} dead refs cleared, ${already} already URLs`,
  );
  totalFixed += fixed;
  totalCleared += cleared;
  totalSkipped += already;
}

// ── fields inside arrays ────────────────────────────────────────────────────
for (const { collection, arrayField, fields } of ARRAY_TARGETS) {
  const coll = db.collection(collection);
  const docs = await coll.find({ [arrayField]: { $type: 'array', $ne: [] } }).toArray();
  const ops = [];
  let fixed = 0;
  let cleared = 0;
  let already = 0;

  for (const doc of docs) {
    let touched = false;
    const next = (doc[arrayField] || []).map((entry) => {
      const copy = { ...entry };
      for (const field of fields) {
        const value = copy[field];
        if (!value) continue;
        if (isAbsolute(value)) {
          already += 1;
          continue;
        }
        const url = urlFor(filenameOf(value));
        if (url) {
          copy[field] = url;
          fixed += 1;
        } else {
          copy[field] = '';
          cleared += 1;
        }
        touched = true;
      }
      return copy;
    });
    if (touched) ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { [arrayField]: next } } } });
  }

  if (!DRY_RUN && ops.length) await coll.bulkWrite(ops, { ordered: false });
  console.log(
    `${`${collection}.${arrayField}[]`.padEnd(24)} ${String(docs.length).padStart(4)} docs   ${fixed} rewritten, ${cleared} dead refs cleared, ${already} already URLs`,
  );
  totalFixed += fixed;
  totalCleared += cleared;
  totalSkipped += already;
}

console.log(`\n${totalFixed} references rewritten, ${totalCleared} dead ones cleared, ${totalSkipped} already absolute`);
if (DRY_RUN) console.log('\nDRY RUN — nothing written.');
else console.log('\nRestart the API afterwards: some catalogs are cached in process memory.');

await mongoose.disconnect();
process.exit(0);
