/**
 * Back up the whole OHO database — every collection, every document.
 *
 *   node scripts/backupDatabase.mjs
 *
 * Run nightly by cron. Each backup is a folder under ~/backups/mongo named by
 * date and time, holding one gzipped file per collection plus manifest.json
 * (document counts and indexes, so a restore can be checked and rebuilt).
 *
 * Documents are written as canonical Extended JSON, which keeps every type
 * exactly — ObjectIds, dates, decimals — so scripts/restoreDatabase.mjs can put
 * them back as they were. mongodump is not installed on this server and cannot
 * be without root, so this uses the MongoDB driver the API already ships with.
 *
 * Safety:
 *   - written to a ".partial" folder and renamed only once complete, so a
 *     crashed or interrupted run can never be mistaken for a good backup
 *   - skipped, with a log line, if the disk has under 2 GB free
 *   - keeps the newest 14 complete backups and deletes older ones
 *   - reads only; never writes to the database
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { BSON } from 'mongodb';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../.env') });

const BACKUP_ROOT = process.env.OHO_BACKUP_DIR || path.join(os.homedir(), 'backups', 'mongo');
const LOG_FILE = path.join(os.homedir(), 'logs', 'oho-backup.log');
const KEEP = Number(process.env.OHO_BACKUP_KEEP || 14);
const MIN_FREE_BYTES = 2 * 1024 ** 3;
const NAME_PATTERN = /^\d{4}-\d{2}-\d{2}_\d{4}$/;

fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
const log = (msg) => {
  const line = `${new Date().toISOString().replace('T', ' ').slice(0, 19)} ${msg}`;
  fs.appendFileSync(LOG_FILE, `${line}\n`);
  console.log(line);
};

const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
};

const freeBytes = (dir) => {
  const s = fs.statfsSync(dir);
  return s.bavail * s.bsize;
};

const main = async () => {
  fs.mkdirSync(BACKUP_ROOT, { recursive: true });

  if (freeBytes(BACKUP_ROOT) < MIN_FREE_BYTES) {
    log(`SKIPPED: under 2 GB free on disk at ${BACKUP_ROOT}`);
    process.exitCode = 1;
    return;
  }

  const name = stamp();
  const finalDir = path.join(BACKUP_ROOT, name);
  const workDir = `${finalDir}.partial`;
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });

  const started = Date.now();
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB_NAME || 'appzeto_taxi' });
  const db = mongoose.connection.db;

  const collections = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith('system.'))
    .sort();

  const manifest = {
    database: db.databaseName,
    startedAt: new Date(started).toISOString(),
    format: 'canonical-extended-json-lines.gz',
    collections: [],
  };

  for (const collName of collections) {
    const coll = db.collection(collName);
    const file = path.join(workDir, `${collName}.ejson.gz`);
    let written = 0;

    // Stream the cursor straight into gzip, one document per line, so memory
    // stays flat however big the collection is.
    const cursor = coll.find({}, { batchSize: 500 });
    const lines = Readable.from((async function* () {
      for await (const doc of cursor) {
        written += 1;
        yield `${BSON.EJSON.stringify(doc, { relaxed: false })}\n`;
      }
    })());
    await pipeline(lines, zlib.createGzip({ level: 6 }), fs.createWriteStream(file));

    manifest.collections.push({
      name: collName,
      documents: written,
      bytes: fs.statSync(file).size,
      indexes: (await coll.indexes()).filter((ix) => ix.name !== '_id_'),
    });
  }

  manifest.finishedAt = new Date().toISOString();
  manifest.totalDocuments = manifest.collections.reduce((n, c) => n + c.documents, 0);
  fs.writeFileSync(path.join(workDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await mongoose.disconnect();

  // Only now does it become a real backup.
  fs.renameSync(workDir, finalDir);

  const totalBytes = manifest.collections.reduce((n, c) => n + c.bytes, 0);
  log(`OK ${name}: ${collections.length} collections, ${manifest.totalDocuments} documents, ${(totalBytes / 1048576).toFixed(1)} MB, ${((Date.now() - started) / 1000).toFixed(0)}s`);

  // Keep the newest KEEP complete backups. Only folders this script created
  // (exact date-time names) are ever touched; leftover .partial folders older
  // than a day are cleared too.
  const complete = fs.readdirSync(BACKUP_ROOT).filter((n) => NAME_PATTERN.test(n)).sort();
  for (const old of complete.slice(0, Math.max(0, complete.length - KEEP))) {
    fs.rmSync(path.join(BACKUP_ROOT, old), { recursive: true, force: true });
    log(`removed old backup ${old}`);
  }
  for (const n of fs.readdirSync(BACKUP_ROOT)) {
    if (!n.endsWith('.partial')) continue;
    const full = path.join(BACKUP_ROOT, n);
    if (Date.now() - fs.statSync(full).mtimeMs > 24 * 3600 * 1000) {
      fs.rmSync(full, { recursive: true, force: true });
      log(`removed abandoned partial backup ${n}`);
    }
  }
};

main()
  .then(() => process.exit(process.exitCode || 0))
  .catch(async (error) => {
    log(`FAILED: ${error.message}`);
    await mongoose.disconnect().catch(() => null);
    process.exit(1);
  });
