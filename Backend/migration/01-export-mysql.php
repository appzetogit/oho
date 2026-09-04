<?php
/**
 * Step 1 — dump the legacy Laravel MySQL tables to JSON.
 *
 * Run from the Laravel app root (it reads DB creds out of that app's .env):
 *   cd ~/htdocs && php ~/apps/oho/Backend/migration/01-export-mysql.php
 *
 * Writes one <table>.json per table into migration/_data/.
 */

$laravelRoot = getcwd();
$outDir      = __DIR__ . '/_data';

// ── Read DB credentials from the Laravel .env ────────────────────────────────
$envPath = $laravelRoot . '/.env';
if (!is_readable($envPath)) {
    fwrite(STDERR, "Cannot read {$envPath} — run this from the Laravel app root.\n");
    exit(1);
}
$env = [];
foreach (file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
    if ($line === '' || $line[0] === '#' || !str_contains($line, '=')) continue;
    [$k, $v] = explode('=', $line, 2);
    $env[trim($k)] = trim(trim($v), "\"'");
}

$host = $env['DB_HOST']     ?? '127.0.0.1';
$port = $env['DB_PORT']     ?? '3306';
$name = $env['DB_DATABASE'] ?? '';
$user = $env['DB_USERNAME'] ?? '';
$pass = $env['DB_PASSWORD'] ?? '';

// Tables worth carrying over. Everything else is empty or Laravel plumbing.
$tables = [
    // reference / config
    'service_locations', 'vehicle_types', 'zones', 'zone_types', 'zone_type_price',
    'cancellation_reasons', 'goods_types', 'settings', 'countries', 'languages',
    // people
    'users', 'drivers', 'owners', 'roles', 'role_user',
    'driver_vehicle_types', 'driver_documents', 'driver_bank_infos', 'driver_needed_documents',
    // money
    'user_wallet', 'user_wallet_history', 'driver_wallet', 'driver_wallet_history',
    // rides
    'requests', 'request_places', 'request_bills', 'request_ratings',
    'request_cancellation_fees',
    // chat
    'conversations', 'messages',
    // phase 2: pricing, loyalty, owner money and remaining config
    'reward_points', 'owner_wallets', 'sub_vehicle_types',
    'subscriptions', 'subscription_details', 'onboarding_screen',
    'banner_images', 'favourite_locations', 'mail_templates',
    'package_types', 'preferences', 'driver_preferences', 'career_applications',
];

@mkdir($outDir, 0755, true);

$pdo = new PDO(
    "mysql:host={$host};port={$port};dbname={$name};charset=utf8mb4",
    $user,
    $pass,
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
);

// Spatial columns can't be JSON-encoded raw — ask MySQL for WKT instead.
$spatial = [];
$q = $pdo->prepare(
    "SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = ? AND data_type IN ('point','linestring','polygon','multipolygon','geometry')"
);
$q->execute([$name]);
// MySQL 8 returns these column labels uppercased; older versions don't.
foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $r) {
    $r = array_change_key_case($r, CASE_LOWER);
    $spatial[$r['table_name']][] = $r['column_name'];
}

$summary = [];
foreach ($tables as $t) {
    $exists = $pdo->prepare(
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = ? AND table_name = ?"
    );
    $exists->execute([$name, $t]);
    if (!$exists->fetchColumn()) {
        fwrite(STDERR, "skip {$t} (no such table)\n");
        continue;
    }

    // Replace geometry columns with their WKT text form.
    $select = '*';
    if (!empty($spatial[$t])) {
        $cols = $pdo->prepare(
            "SELECT column_name FROM information_schema.columns
             WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position"
        );
        $cols->execute([$name, $t]);
        $parts = [];
        foreach ($cols->fetchAll(PDO::FETCH_COLUMN) as $c) {
            $parts[] = in_array($c, $spatial[$t], true)
                ? "ST_AsText(`{$c}`) AS `{$c}`"
                : "`{$c}`";
        }
        $select = implode(', ', $parts);
    }

    $rows = $pdo->query("SELECT {$select} FROM `{$t}`")->fetchAll(PDO::FETCH_ASSOC);
    file_put_contents(
        "{$outDir}/{$t}.json",
        json_encode($rows, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE)
    );
    $summary[$t] = count($rows);
    printf("%-32s %6d rows\n", $t, count($rows));
}

file_put_contents("{$outDir}/_summary.json", json_encode($summary, JSON_PRETTY_PRINT));
echo "\nExported " . count($summary) . " tables to {$outDir}\n";
