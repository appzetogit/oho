/**
 * Restore a backup made by scripts/backupDatabase.mjs.
 *
 *   node scripts/restoreDatabase.mjs <backup-folder> --into <database>
 *   node scripts/restoreDatabase.mjs <backup-folder> --into <database> --prefix restoretest_
 *
 * --prefix writes each collection under a new name (restoretest_taxirides…)
 * instead of its own, so a backup can be test-restored into the live database
 * without touching a single live collection. The app's database user only has
 * rights on the live database, so this is how restores are rehearsed.
 *
 * Restores into whatever database --into names. To protect the live data it
 * REFUSES to restore into the live database (the one in .env) unless you also
 * pass --replace-live-data — and then it says plainly what it is about to wipe.
 * The normal, safe move is to restore into a separate database, check it, and
 * only then decide what to do.
 *
 * Every collection in the target is dropped and rebuilt from the backup, its
 * indexes recreated, and the document count checked against the manifest.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { BSON } from 'mongodb';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../.env') });

const args = process.argv.slice(2);
const folder = args.find((a) => !a.startsWith('--'));
const intoIndex = args.indexOf('--into');
const target = intoIndex >= 0 ? args[intoIndex + 1] : '';
const replaceLive = args.includes('--replace-live-data');
const prefixIndex = args.indexOf('--prefix');
const prefix = prefixIndex >= 0 ? String(args[prefixIndex + 1] || '') : '';
if (prefixIndex >= 0 && !/^[a-z][a-z0-9_]{2,30}_$/.test(prefix)) {
  console.error('\nREFUSED: --prefix must look like restoretest_ (lowercase, ending in _)\n');
  process.exit(1);
}
const liveDb = process.env.MONGODB_DB_NAME || 'appzeto_taxi';

const fail = (msg) => { console.error(`\nREFUSED: ${msg}\n`); process.exit(1); };

if (!folder || !target) {
  fail('usage: node scripts/restoreDatabase.mjs <backup-folder> --into <database>');
}
const manifestPath = path.join(folder, 'manifest.json');
if (!fs.existsSync(manifestPath)) fail(`${folder} has no manifest.json — not a complete backup`);
if (target === liveDb && !replaceLive && !prefix) {
  fail(`"${target}" is the LIVE database. Restore into a different database first (e.g. --into ${liveDb}_restored),\n` +
       '         or add --replace-live-data if you really mean to overwrite live data with this backup.');
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
console.log(`backup:  ${path.basename(folder)}  (taken ${manifest.startedAt}, ${manifest.totalDocuments} documents)`);
console.log(`into:    ${target}${prefix ? ` (as ${prefix}<collection> — live collections untouched)` : target === liveDb ? '   <-- LIVE DATABASE, everything in it will be replaced' : ''}`);

await mongoose.connect(process.env.MONGODB_URI, { dbName: liveDb });
const db = mongoose.connection.useDb(target, { useCache: false }).db;

let problems = 0;
for (const entry of manifest.collections) {
  const file = path.join(folder, `${entry.name}.ejson.gz`);
  const targetName = `${prefix}${entry.name}`;
  const coll = db.collection(targetName);
  await coll.drop().catch(() => null); // may not exist yet

  const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  let batch = [];
  let inserted = 0;
  for await (const line of rl) {
    if (!line) continue;
    batch.push(BSON.EJSON.parse(line, { relaxed: false }));
    if (batch.length === 1000) {
      await coll.insertMany(batch, { ordered: false });
      inserted += batch.length;
      batch = [];
    }
  }
  if (batch.length) {
    await coll.insertMany(batch, { ordered: false });
    inserted += batch.length;
  }
  if (inserted === 0) await db.createCollection(targetName).catch(() => null);

  for (const ix of entry.indexes || []) {
    const { key, name, v, ns, ...options } = ix;
    await coll.createIndex(key, { name, ...options }).catch((e) => console.warn(`  index ${entry.name}.${name}: ${e.message}`));
  }

  const count = await coll.countDocuments();
  const ok = count === entry.documents;
  if (!ok) problems += 1;
  console.log(`  ${ok ? 'ok  ' : 'MISMATCH'} ${entry.name.padEnd(40)} ${count} / ${entry.documents}`);
}

await mongoose.disconnect();
console.log(problems ? `\nfinished with ${problems} mismatched collection(s)` : '\nrestore complete — every collection matches the backup');
process.exit(problems ? 1 : 0);
