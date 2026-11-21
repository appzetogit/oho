import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyHike,
  computeDistanceFare,
  computeListFare,
  correctCompletedTripFare,
  isRoundTripIntercity,
  priceBookingFare,
  stopsToWaypoints,
  odometerStepMeters,
} from '../fareGuardRules.js';

// The live Auto price row (Balasore/Bhubaneswar fallback) on 21 Nov 2026.
const AUTO = { base_price: 50, base_distance: 3, price_per_distance: 8, time_price: 2 };

test('formula matches fares the apps produced on live rides', () => {
  assert.equal(Math.round(computeDistanceFare(AUTO, 1390.43, 3.337)), 57);
  assert.equal(Math.round(computeDistanceFare(AUTO, 6510, 15.6)), 109);
  assert.equal(Math.round(computeDistanceFare(AUTO, 7290, 17.5)), 119);
});

test('booking: exactly the price list for the road distance', () => {
  // Remuna -> Sai Nilaya: app priced 7.29 km straight line at Rs119; road is 10.6 km.
  const result = priceBookingFare({ rule: AUTO, clientDistanceMeters: 7290, clientDurationMinutes: 17.5, roadDistanceMeters: 10600 });
  assert.equal(result.source, 'road');
  assert.equal(result.distanceMeters, 10600);
  // 50 + 7.6 km * 8 + (10.6 km * 2.4 min/km) * 2
  assert.equal(result.fare, Math.round(50 + 7.6 * 8 + 10.6 * (17.5 / 7.29) * 2));
});

test('booking: same distance gives the same fare the app shows', () => {
  assert.equal(priceBookingFare({ rule: AUTO, clientDistanceMeters: 6510, clientDurationMinutes: 15.6, roadDistanceMeters: 6510 }).fare, 109);
});

test('booking: a fare the app sent too high or too low does not matter', () => {
  // The app's fare is not an input at all: only the price list and distance are.
  const a = priceBookingFare({ rule: AUTO, clientDistanceMeters: 5000, clientDurationMinutes: 12, roadDistanceMeters: 6000 });
  assert.equal(a.fare, computeListFare(AUTO, 6000, 6 * 2.4));
});

test('booking: route lookup failed -> app distance, still priced from the list', () => {
  const result = priceBookingFare({ rule: AUTO, clientDistanceMeters: 1390, clientDurationMinutes: 3.337, roadDistanceMeters: null });
  assert.equal(result.source, 'app_distance');
  assert.equal(result.fare, 57);
});

test('booking: unpriceable rides keep the app fare (null)', () => {
  assert.equal(priceBookingFare({ rule: null, clientDistanceMeters: 1390, roadDistanceMeters: 2000 }), null);
  assert.equal(priceBookingFare({ rule: AUTO, clientDistanceMeters: 0, roadDistanceMeters: null }), null);
  assert.equal(priceBookingFare({ rule: { base_price: 0, price_per_distance: 0, time_price: 0 }, clientDistanceMeters: 1000, roadDistanceMeters: 2000 }), null);
});

test('booking: price hike and service tax follow the price list', () => {
  const hiked = applyHike(AUTO, 1.5);
  assert.deepEqual([hiked.base_price, hiked.price_per_distance, hiked.time_price, hiked.base_distance], [75, 12, 3, 3]);
  assert.equal(applyHike(AUTO, 1), AUTO);
  assert.equal(computeListFare({ ...AUTO, service_tax: 5 }, 1390, 3.337), Math.round(56.674 * 1.05));
});

const tripRide = (over = {}) => ({
  serviceType: 'ride',
  pricingNegotiationMode: 'none',
  fare: 57,
  estimatedDistanceMeters: 1390,
  estimatedDurationMinutes: 3.34,
  tripDistanceMeters: 11000,
  promo: { code: '', discount_amount: 0 },
  subscriptionUsage: undefined,
  ...over,
});

test('trip: a trip driven far beyond the booking is billed for the distance driven', () => {
  const result = correctCompletedTripFare({ ride: tripRide(), rule: AUTO });
  assert.ok(result);
  assert.equal(result.billedDistanceMeters, 11000);
  assert.ok(result.fare > 150);
});

test('trip: small overruns, promos, subscriptions, bids and parcels are untouched', () => {
  assert.equal(correctCompletedTripFare({ ride: tripRide({ tripDistanceMeters: 2000 }), rule: AUTO }), null);
  assert.equal(correctCompletedTripFare({ ride: tripRide({ estimatedDistanceMeters: 9000, tripDistanceMeters: 10000 }), rule: AUTO }), null);
  assert.equal(correctCompletedTripFare({ ride: tripRide({ promo: { code: 'NEW50', discount_amount: 20 } }), rule: AUTO }), null);
  assert.equal(correctCompletedTripFare({ ride: tripRide({ subscriptionUsage: { covered: true } }), rule: AUTO }), null);
  assert.equal(correctCompletedTripFare({ ride: tripRide({ pricingNegotiationMode: 'driver_bid' }), rule: AUTO }), null);
  assert.equal(correctCompletedTripFare({ ride: tripRide({ serviceType: 'parcel' }), rule: AUTO }), null);
  assert.equal(correctCompletedTripFare({ ride: tripRide({ tripDistanceMeters: 0 }), rule: AUTO }), null);
  assert.equal(correctCompletedTripFare({ ride: tripRide(), rule: null }), null);
});

test('trip: GPS runaway is capped at 40 km beyond the booking', () => {
  const result = correctCompletedTripFare({ ride: tripRide({ tripDistanceMeters: 500000 }), rule: AUTO });
  assert.equal(result.billedDistanceMeters, 1390 + 40000);
});

test('odometer: ignores jitter and teleports, keeps real movement', () => {
  const t0 = '2026-11-21T05:00:00Z';
  const a = [86.9147, 21.4809];
  // ~5 m: jitter.
  assert.equal(odometerStepMeters({ previousCoordinates: a, previousAt: t0, nextCoordinates: [86.91475, 21.4809], nextAt: '2026-11-21T05:00:04Z' }), 0);
  // ~110 m in 10 s: real.
  const step = odometerStepMeters({ previousCoordinates: a, previousAt: t0, nextCoordinates: [86.9147, 21.4819], nextAt: '2026-11-21T05:00:10Z' });
  assert.ok(step > 100 && step < 120);
  // ~11 km in 5 s: teleport.
  assert.equal(odometerStepMeters({ previousCoordinates: a, previousAt: t0, nextCoordinates: [86.9147, 21.58], nextAt: '2026-11-21T05:00:05Z' }), 0);
  // ~2.2 km over 5 minutes of silence: kept.
  const gap = odometerStepMeters({ previousCoordinates: a, previousAt: t0, nextCoordinates: [86.9147, 21.5009], nextAt: '2026-11-21T05:05:00Z' });
  assert.ok(gap > 2000 && gap < 2300);
});

test('booking: a round trip charges both legs and the base fare once, as the app does', () => {
  const one = priceBookingFare({ rule: AUTO, clientDistanceMeters: 5000, clientDurationMinutes: 12, roadDistanceMeters: 6000 });
  const both = priceBookingFare({ rule: AUTO, clientDistanceMeters: 5000, clientDurationMinutes: 12, roadDistanceMeters: 6000, roundTrip: true });
  // 50 + (12 - 3) km * 8 + 2 * (6 km * 2.4 min/km) * 2
  assert.equal(both.fare, Math.round(50 + 9 * 8 + 12 * 2.4 * 2));
  assert.ok(both.fare > one.fare);
  assert.equal(both.distanceMeters, 6000);
  assert.equal(isRoundTripIntercity({ tripType: 'round_trip' }), true);
  assert.equal(isRoundTripIntercity({ tripType: 'one_way' }), false);
  assert.equal(isRoundTripIntercity(undefined), false);
});

test('booking: a road route shorter than the app distance (unknown stops) uses the app distance', () => {
  const result = priceBookingFare({ rule: AUTO, clientDistanceMeters: 9000, clientDurationMinutes: 21.6, roadDistanceMeters: 4000 });
  assert.equal(result.source, 'app_distance');
  assert.equal(result.distanceMeters, 9000);
});

test('stops become routing waypoints; junk is dropped', () => {
  assert.equal(stopsToWaypoints([{ lat: 21.49, lng: 86.91 }, { lat: 'x', lng: 1 }, { lat: 21.5, lng: 86.92 }]), '21.49,86.91|21.5,86.92');
  assert.equal(stopsToWaypoints(null), '');
  assert.equal(stopsToWaypoints([{ lat: 200, lng: 1 }]), '');
});

test('trip: a round trip driven both ways is not charged extra', () => {
  const ride = tripRide({ estimatedDistanceMeters: 5000, estimatedDurationMinutes: 12, tripDistanceMeters: 10500, intercity: { tripType: 'round_trip' } });
  assert.equal(correctCompletedTripFare({ ride, rule: AUTO }), null);
  const longer = tripRide({ estimatedDistanceMeters: 5000, estimatedDurationMinutes: 12, tripDistanceMeters: 16000, intercity: { tripType: 'round_trip' } });
  assert.ok(correctCompletedTripFare({ ride: longer, rule: AUTO }).fare > longer.fare);
});
