// node --test src/modules/taxi/rideIncentives/__tests__/incentiveRules.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decideIncentive,
  incentiveAmount,
  incentiveSettingsProblem,
  normalizeIncentiveSettings,
} from '../services/incentiveRules.js';

const BIKE = 'bike-id';
const settings = (extra = {}) => normalizeIncentiveSettings({
  enabled: true,
  rates: [{ vehicleTypeId: BIKE, amount_per_ride: 20 }],
  ...extra,
});
const driver = { phone: '9000000001', approve: true, status: 'approved', deletedAt: null };
const ride = { serviceType: 'ride', vehicleTypeId: BIKE, estimatedDistanceMeters: 3000 };

test('flat amount per ride ignores distance', () => {
  assert.equal(incentiveAmount({ amount_per_ride: 20, amount_per_km: 0, max_per_ride: 0 }, 3000), 20);
  assert.equal(incentiveAmount({ amount_per_ride: 20, amount_per_km: 0, max_per_ride: 0 }, 30000), 20);
});

test('per km, and flat plus per km, respect the ceiling', () => {
  assert.equal(incentiveAmount({ amount_per_ride: 0, amount_per_km: 8, max_per_ride: 0 }, 2500), 20);
  assert.equal(incentiveAmount({ amount_per_ride: 5, amount_per_km: 3, max_per_ride: 0 }, 2000), 11);
  assert.equal(incentiveAmount({ amount_per_ride: 0, amount_per_km: 8, max_per_ride: 30 }, 10000), 30);
  assert.equal(incentiveAmount(undefined, 2000), 0);
});

test('defaults are the agreed limits', () => {
  const s = normalizeIncentiveSettings({});
  assert.equal(s.enabled, false);
  assert.equal(s.max_rides_per_driver_per_day, 10);
  assert.equal(s.min_distance_km, 1);
});

test('a qualifying ride pays', () => {
  assert.deepEqual(decideIncentive({ settings: settings(), ride, driver }), { pay: true, amount: 20, reason: '' });
});

test('rides that do not qualify say why', () => {
  const reason = (args) => decideIncentive({ settings: settings(), ride, driver, ...args }).reason;
  assert.equal(reason({ ride: { ...ride, estimatedDistanceMeters: 999 } }), 'ride too short');
  assert.equal(decideIncentive({ settings: settings(), ride: { ...ride, estimatedDistanceMeters: 1000 }, driver }).pay, true);
  assert.equal(reason({ paidToday: 10 }), 'daily limit reached');
  assert.equal(decideIncentive({ settings: settings(), ride, driver, paidToday: 9 }).pay, true);
  assert.equal(reason({ ride: { ...ride, vehicleTypeId: 'auto-id' } }), 'no amount set for this vehicle');
  assert.equal(reason({ ride: { ...ride, serviceType: 'parcel' } }), 'not a normal ride');
  assert.equal(reason({ driver: { ...driver, approve: false } }), 'driver not approved');
  assert.equal(reason({ driver: { ...driver, deletedAt: new Date() } }), 'driver not approved');
});

test('limits can be turned off with 0', () => {
  const open = settings({ max_rides_per_driver_per_day: 0, min_distance_km: 0 });
  assert.equal(decideIncentive({ settings: open, ride: { ...ride, estimatedDistanceMeters: 10 }, driver, paidToday: 999 }).pay, true);
});

test('test list limits who earns', () => {
  const only = settings({ only_driver_phones: '9000000002' });
  assert.equal(decideIncentive({ settings: only, ride, driver }).reason, 'driver not on the test list');
  assert.equal(decideIncentive({ settings: only, ride, driver: { ...driver, phone: '9000000002' } }).pay, true);
});

test('bad settings are refused', () => {
  assert.match(incentiveSettingsProblem(normalizeIncentiveSettings({ enabled: true }), ''), /at least one vehicle/);
  assert.equal(incentiveSettingsProblem(normalizeIncentiveSettings({ enabled: false }), ''), '');
  assert.match(incentiveSettingsProblem(settings(), '900000'), /invalid phone number/);
  assert.equal(incentiveSettingsProblem(settings(), '9000000001'), '');
});
