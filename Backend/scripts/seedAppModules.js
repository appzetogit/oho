/**
 * Seed the mobile app's service modules, uploading a real icon for each.
 *
 *   node scripts/seedAppModules.js --dry-run
 *   node scripts/seedAppModules.js
 *
 * Goes through the admin API rather than writing the collection directly, so
 * images land in the same uploads folder the panel uses and the records get the
 * same validation. Idempotent: a module whose name already exists is left
 * alone, so re-running only fills in what is missing.
 *
 * Icons are the vehicle thumbnails already in frontend/public/vehicles, so the
 * app menu matches the artwork on the marketing site.
 */

import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const BASE = process.env.SEED_API_BASE || 'https://ohoride.in/api/v1';
const EMAIL = process.env.ADMIN_EMAIL || 'admin@ohoride.com';
const PASSWORD = process.env.ADMIN_PASSWORD;
const DRY_RUN = process.argv.includes('--dry-run');

if (!PASSWORD) {
  console.error('Set ADMIN_PASSWORD in the environment, e.g. ADMIN_PASSWORD=... node scripts/seedAppModules.js');
  process.exit(1);
}

// Image paths are resolved against the repo so this works from a checkout;
// override with SEED_IMAGE_DIR when the frontend lives elsewhere.
const IMAGE_DIR = process.env.SEED_IMAGE_DIR || path.resolve(__dirname, '../../frontend/public/vehicles');

const MODULES = [
  {
    name: 'Auto',
    transport_type: 'taxi',
    service_type: 'normal',
    short_description: 'Normal Taxi',
    description: 'Auto-rickshaw rides for short city trips.',
    order_by: 3,
    image: 'ride_auto.jpg',
  },
  {
    name: 'Cab',
    transport_type: 'taxi',
    service_type: 'normal',
    short_description: 'Normal Taxi',
    description: 'Air-conditioned sedans for everyday city travel.',
    order_by: 4,
    image: 'ride_sedan.jpg',
  },
  {
    name: 'SUV',
    transport_type: 'taxi',
    service_type: 'normal',
    short_description: 'Normal Taxi',
    description: 'Larger vehicles for groups and luggage.',
    order_by: 5,
    image: 'ride_innova.jpg',
  },
  {
    name: 'Intercity',
    transport_type: 'taxi',
    service_type: 'outstation',
    short_description: 'Outstation Taxi',
    description: 'One-way and round trips between cities.',
    order_by: 6,
    image: 'ride_ertiga.jpg',
  },
];

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

const req = async (method, url, body, token) => {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body: json };
};

// ── log in ───────────────────────────────────────────────────────────────────
const login = await req('POST', '/admin/login', { email: EMAIL, password: PASSWORD });
const token = login.body?.data?.token || login.body?.token;
if (!token) {
  console.error('Admin login failed:', login.status, JSON.stringify(login.body).slice(0, 200));
  process.exit(1);
}
console.log(`Logged in as ${EMAIL}${DRY_RUN ? '   [DRY RUN — nothing will be created]' : ''}\n`);

// ── what already exists ──────────────────────────────────────────────────────
const existing = await req('GET', '/admin/common/app-modules?page=1&limit=100', null, token);
const rows = existing.body?.data?.results || existing.body?.results || [];
const byName = new Map(rows.map((m) => [String(m.name).trim().toLowerCase(), m]));
console.log(`Existing modules (${rows.length}): ${rows.map((m) => m.name).join(', ') || '(none)'}\n`);

let created = 0;
let skipped = 0;
let failed = 0;

for (const mod of MODULES) {
  const key = mod.name.trim().toLowerCase();
  if (byName.has(key)) {
    console.log(`- ${mod.name.padEnd(12)} already exists, left alone`);
    skipped += 1;
    continue;
  }

  const imagePath = path.join(IMAGE_DIR, mod.image);
  if (!fs.existsSync(imagePath)) {
    console.log(`! ${mod.name.padEnd(12)} image not found: ${imagePath}`);
    failed += 1;
    continue;
  }

  const buf = fs.readFileSync(imagePath);
  const mime = MIME[path.extname(mod.image).toLowerCase()] || 'image/jpeg';
  const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;

  if (DRY_RUN) {
    console.log(`+ ${mod.name.padEnd(12)} would upload ${mod.image} (${Math.round(buf.length / 1024)} KB) and create the module`);
    created += 1;
    continue;
  }

  // Same endpoint and folder the admin panel's image picker uses, so the file
  // ends up beside the icons uploaded by hand.
  const up = await req('POST', '/common/upload/image', { image: dataUrl, folder: 'app-modules' }, token);
  const iconUrl = up.body?.data?.url || up.body?.url;
  if (!iconUrl) {
    console.log(`! ${mod.name.padEnd(12)} image upload failed: ${up.status} ${JSON.stringify(up.body).slice(0, 120)}`);
    failed += 1;
    continue;
  }

  const payload = {
    name: mod.name,
    transport_type: mod.transport_type,
    service_type: mod.service_type,
    short_description: mod.short_description,
    description: mod.description,
    order_by: mod.order_by,
    mobile_menu_icon: iconUrl,
    active: 1,
  };

  const res = await req('POST', '/admin/common/app-modules', payload, token);
  if (res.status >= 200 && res.status < 300 && res.body?.success !== false) {
    console.log(`+ ${mod.name.padEnd(12)} created  (${Math.round(buf.length / 1024)} KB icon)`);
    created += 1;
  } else {
    console.log(`! ${mod.name.padEnd(12)} create failed: ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
    failed += 1;
  }
}

// ── report ───────────────────────────────────────────────────────────────────
console.log(`\ncreated ${created}, skipped ${skipped}, failed ${failed}`);

if (!DRY_RUN) {
  const after = await req('GET', '/admin/common/app-modules?page=1&limit=100', null, token);
  const list = after.body?.data?.results || after.body?.results || [];
  console.log(`\nmodules now (${list.length}):`);
  for (const m of list.sort((a, b) => (a.order_by || 0) - (b.order_by || 0))) {
    console.log(`  ${String(m.order_by).padStart(2)}. ${String(m.name).padEnd(12)} ${m.transport_type}/${m.service_type}  icon=${m.mobile_menu_icon ? 'yes' : 'MISSING'}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
