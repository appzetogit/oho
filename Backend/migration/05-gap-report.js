/**
 * Step 5 — what did NOT come across? Compares every non-empty legacy table
 * against the migration's coverage. Counts and table names only, no row data.
 *
 *   cd ~/htdocs && php ~/apps/oho/Backend/migration/gap.php   # writes _counts.json
 *   cd ~/apps/oho/Backend && node migration/05-gap-report.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const D = path.join(path.dirname(fileURLToPath(import.meta.url)), '_data');
const counts = JSON.parse(fs.readFileSync(path.join(D, '_counts.json'), 'utf8'));

// How each legacy table was treated. Anything absent here is unclassified and
// gets flagged, so a table can't be silently forgotten.
const DISPOSITION = {
  // ── fully carried into a Mongo collection ──
  users: ['MIGRATED', 'taxiusers + taxidrivers (split by role)'],
  drivers: ['MIGRATED', 'taxidrivers'],
  owners: ['MIGRATED', 'taxiowners'],
  requests: ['MIGRATED', 'taxirides'],
  request_places: ['MIGRATED', 'taxirides.pickup/dropLocation'],
  request_bills: ['MIGRATED', 'taxirides.fare/baseFare/commission'],
  request_ratings: ['MIGRATED', 'taxirides.feedback'],
  user_wallet: ['MIGRATED', 'taxiuserwallets.balance'],
  user_wallet_history: ['MIGRATED', 'taxiuserwallets.transactions'],
  driver_wallet: ['MIGRATED', 'taxidrivers.wallet'],
  driver_wallet_history: ['MIGRATED', 'wallettransactions'],
  driver_documents: ['MIGRATED', 'taxidrivers.documents'],
  driver_bank_infos: ['MIGRATED', 'taxidrivers.bankDetails'],
  driver_vehicle_types: ['MIGRATED', 'taxidrivers.vehicleTypeId'],
  vehicle_types: ['MIGRATED', 'taxivehicles'],
  service_locations: ['MIGRATED', 'taxiservicelocations'],
  zones: ['MIGRATED', 'taxizones'],
  cancellation_reasons: ['MIGRATED', 'taxicancellationreasons'],

  // ── deliberately dropped: Laravel internals with no meaning in the new app ──
  migrations: ['SKIP-PLUMBING', 'Laravel migration ledger'],
  personal_access_tokens: ['SKIP-PLUMBING', 'Sanctum tokens — users re-login'],
  password_resets: ['SKIP-PLUMBING', 'expired reset tokens'],
  password_reset_tokens: ['SKIP-PLUMBING', 'expired reset tokens'],
  sessions: ['SKIP-PLUMBING', 'PHP sessions'],
  failed_jobs: ['SKIP-PLUMBING', 'dead queue jobs'],
  jobs: ['SKIP-PLUMBING', 'queue backlog'],
  mobile_otp_verifications: ['SKIP-PLUMBING', 'spent OTP codes'],
  mail_otp_verifications: ['SKIP-PLUMBING', 'spent OTP codes'],
  websockets_statistics_entries: ['SKIP-PLUMBING', 'websocket metrics'],
  time_zones: ['SKIP-REFERENCE', 'static lookup — app has its own'],
  countries: ['SKIP-REFERENCE', 'static lookup — app has its own'],
  languages: ['SKIP-REFERENCE', 'static lookup'],
  language: ['SKIP-REFERENCE', 'static lookup'],
  ltm_translations: ['SKIP-REFERENCE', 'i18n strings'],
  permissions: ['SKIP-RBAC', 'Laravel RBAC — new app has its own admin roles'],
  permission_role: ['SKIP-RBAC', 'Laravel RBAC'],
  roles: ['SKIP-RBAC', 'Laravel RBAC'],
  role_user: ['SKIP-RBAC', 'used only to split riders from drivers'],
  admin_details: ['SKIP-RBAC', 'replaced by the seeded admin account'],

  // ── real data that did NOT come across ──
  driver_availabilities: ['NOT-MIGRATED', 'driver online/offline history'],
  recent_searches: ['NOT-MIGRATED', 'rider search history'],
  request_eta: ['NOT-MIGRATED', 'per-ride ETA snapshots'],
  reward_points: ['NOT-MIGRATED', 'loyalty points balances'],
  user_driver_notifications: ['NOT-MIGRATED', 'push notification log'],
  driver_rejected_requests: ['NOT-MIGRATED', 'which rides drivers declined'],
  settings: ['NOT-MIGRATED', 'app config (already configured in new admin)'],
  third_party_settings: ['NOT-MIGRATED', 'API keys config (placeholders only)'],
  request_cancellation_fees: ['NOT-MIGRATED', 'cancellation charges'],
  conversations: ['NOT-MIGRATED', 'rider-driver chat threads'],
  messages: ['NOT-MIGRATED', 'rider-driver chat messages'],
  chats: ['NOT-MIGRATED', 'older chat system'],
  owner_wallets: ['NOT-MIGRATED', 'fleet owner wallet balances'],
  zone_types: ['NOT-MIGRATED', 'zone pricing rules'],
  zone_type_price: ['NOT-MIGRATED', 'zone pricing rules'],
  goods_types: ['NOT-MIGRATED', 'parcel item categories'],
  sub_vehicle_types: ['NOT-MIGRATED', 'vehicle sub-categories'],
  subscriptions: ['NOT-MIGRATED', 'driver subscription plans'],
  subscription_details: ['NOT-MIGRATED', 'driver subscription plans'],
  notification_channels: ['NOT-MIGRATED', 'push/SMS channel config'],
  driver_needed_documents: ['NOT-MIGRATED', 'which docs drivers must upload'],
  onboarding_screen: ['NOT-MIGRATED', 'app onboarding slides'],
  banner_images: ['NOT-MIGRATED', 'promo banners'],
  mail_templates: ['NOT-MIGRATED', 'email templates'],
  invoice_configurations: ['NOT-MIGRATED', 'invoice layout'],
  mobile_app_settings: ['NOT-MIGRATED', 'mobile app config'],
  favourite_locations: ['NOT-MIGRATED', 'rider saved places'],
  fields: ['NOT-MIGRATED', 'bank-detail form field defs'],
  methods: ['NOT-MIGRATED', 'payout method defs'],
  notifications: ['NOT-MIGRATED', 'admin notification'],
  sos: ['NOT-MIGRATED', 'one SOS record'],
  wallet_withdrawal_requests: ['NOT-MIGRATED', 'one payout request'],
  landing_abouts: ['NOT-MIGRATED', 'old Laravel landing page copy'],
  landing_contacts: ['NOT-MIGRATED', 'old Laravel landing page copy'],
  landing_drivers: ['NOT-MIGRATED', 'old Laravel landing page copy'],
  landing_headers: ['NOT-MIGRATED', 'old Laravel landing page copy'],
  landing_homes: ['NOT-MIGRATED', 'old Laravel landing page copy'],
  landing_quicklinks: ['NOT-MIGRATED', 'old Laravel landing page copy'],
  landing_users: ['NOT-MIGRATED', 'old Laravel landing page copy'],
};

// Translation side-tables ride along with their parent; group them together.
const isTranslation = (t) => /_translations?$/.test(t) || t === 'zone_translations';

const buckets = { MIGRATED: [], 'NOT-MIGRATED': [], SKIP: [], TRANSLATION: [], UNCLASSIFIED: [] };

for (const [table, n] of Object.entries(counts)) {
  if (n === 0) continue;
  if (isTranslation(table)) {
    buckets.TRANSLATION.push([table, n, 'i18n side-table']);
    continue;
  }
  const d = DISPOSITION[table];
  if (!d) {
    buckets.UNCLASSIFIED.push([table, n, '(!) not accounted for']);
    continue;
  }
  const [kind, why] = d;
  if (kind === 'MIGRATED') buckets.MIGRATED.push([table, n, why]);
  else if (kind === 'NOT-MIGRATED') buckets['NOT-MIGRATED'].push([table, n, why]);
  else buckets.SKIP.push([table, n, why]);
}

const show = (title, rows) => {
  if (!rows.length) return;
  const total = rows.reduce((a, r) => a + r[1], 0);
  console.log(`\n=== ${title} — ${rows.length} tables, ${total.toLocaleString()} rows ===`);
  for (const [t, n, why] of rows.sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t.padEnd(32)} ${String(n).padStart(5)}   ${why}`);
  }
};

const nonEmpty = Object.values(counts).filter(Boolean).length;
const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`Legacy DB: ${Object.keys(counts).length} tables, ${nonEmpty} non-empty, ${totalRows.toLocaleString()} rows total`);

show('CARRIED OVER', buckets.MIGRATED);
show('LEFT BEHIND — real data', buckets['NOT-MIGRATED']);
show('LEFT BEHIND — deliberately (Laravel internals / static lookups)', buckets.SKIP);
show('LEFT BEHIND — i18n side-tables', buckets.TRANSLATION);
show('UNCLASSIFIED — needs a decision', buckets.UNCLASSIFIED);

const pct = (rows) => ((rows.reduce((a, r) => a + r[1], 0) / totalRows) * 100).toFixed(1);
console.log(`\n--- share of all rows ---`);
console.log(`  carried over      ${pct(buckets.MIGRATED)}%`);
console.log(`  left behind (real)${pct(buckets['NOT-MIGRATED']).padStart(6)}%`);
console.log(`  deliberately skipped ${pct(buckets.SKIP)}%`);
console.log();
