/**
 * Repair the migrated cancellation reasons so the apps can actually read them.
 *
 *   node migration/09-fix-cancellation-reasons.js --dry-run
 *   node migration/09-fix-cancellation-reasons.js
 *
 * The migration copied the MySQL column names — `reason` and `user_type` — but
 * CancellationReason.js declares `title` and `audience`. Both are written
 * through the native driver, so nothing complained; the rows just sat there
 * while GET /users/cancellation-reasons?audience=user, which filters on
 * { audience, active }, matched none of them and every app showed an empty list.
 *
 * Also collapses duplicates. The source had the same wording several times over
 * ("Do not want to say" three times for riders), which would render as a list of
 * repeats. When duplicates disagree on `active`, the active one wins, so a
 * reason is not lost to an inactive twin.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const DRY_RUN = process.argv.includes('--dry-run');

await mongoose.connect(process.env.MONGODB_URI, {
  dbName: process.env.MONGODB_DB_NAME || 'appzeto_taxi',
});
const db = mongoose.connection.db;
const coll = db.collection('taxicancellationreasons');

const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ');
const key = (audience, title) => `${audience}::${norm(title).toLowerCase()}`;

const rows = await coll.find({}).toArray();
console.log(`${rows.length} cancellation reason documents\n`);

// ── collapse duplicates, preferring an active row ───────────────────────────
const winners = new Map();
let duplicates = 0;

for (const r of rows) {
  // Accept either shape so this is safe to re-run after a partial fix.
  const title = norm(r.title || r.reason);
  const audience = String(r.audience || r.user_type || 'user').trim().toLowerCase() === 'driver' ? 'driver' : 'user';
  if (!title) continue;

  const k = key(audience, title);
  const active = r.active !== false;
  const existing = winners.get(k);

  if (!existing) {
    winners.set(k, { _id: r._id, title, audience, active, extras: [] });
    continue;
  }
  duplicates += 1;
  // An active duplicate beats an inactive survivor.
  if (active && !existing.active) {
    existing.extras.push(existing._id);
    existing._id = r._id;
    existing.active = true;
  } else {
    existing.extras.push(r._id);
  }
}

// ── order: keep a stable list, with the catch-all last ──────────────────────
const isCatchAll = (t) => /^other$/i.test(t) || /do not want to say/i.test(t);

const byAudience = { user: [], driver: [] };
for (const w of winners.values()) byAudience[w.audience].push(w);
for (const a of Object.keys(byAudience)) {
  byAudience[a].sort((x, y) => {
    const c = Number(isCatchAll(x.title)) - Number(isCatchAll(y.title));
    return c !== 0 ? c : x.title.localeCompare(y.title);
  });
  byAudience[a].forEach((w, i) => {
    w.order_by = (i + 1) * 10;
    // "Other" is only useful if it collects what the person actually meant.
    w.requiresNote = isCatchAll(w.title);
  });
}

const updates = [];
const deletions = [];
for (const a of ['user', 'driver']) {
  console.log(`${a} (${byAudience[a].length} after dedupe):`);
  for (const w of byAudience[a]) {
    console.log(
      `  ${String(w.order_by).padStart(3)}  ${w.title}${w.requiresNote ? '   [asks for a note]' : ''}${w.active ? '' : '   [inactive]'}`,
    );
    updates.push({
      updateOne: {
        filter: { _id: w._id },
        update: {
          $set: { title: w.title, audience: w.audience, order_by: w.order_by, requiresNote: w.requiresNote, active: w.active },
          // drop the MySQL column names now that the real fields are set
          $unset: { reason: '', user_type: '' },
        },
      },
    });
    for (const id of w.extras) deletions.push(id);
  }
  console.log();
}

console.log(`${updates.length} to rewrite, ${deletions.length} duplicates to remove (${duplicates} found)`);

if (DRY_RUN) {
  console.log('\nDRY RUN — nothing written.');
} else {
  if (updates.length) await coll.bulkWrite(updates, { ordered: false });
  if (deletions.length) await coll.deleteMany({ _id: { $in: deletions } });

  const remaining = await coll.countDocuments();
  const readable = await coll.countDocuments({ audience: { $in: ['user', 'driver'] }, title: { $exists: true } });
  console.log(`\ndocuments now: ${remaining}, with the fields the app queries: ${readable}`);
  console.log(`  user   visible to the app: ${await coll.countDocuments({ audience: 'user', active: true })}`);
  console.log(`  driver visible to the app: ${await coll.countDocuments({ audience: 'driver', active: true })}`);
}

await mongoose.disconnect();
process.exit(0);
