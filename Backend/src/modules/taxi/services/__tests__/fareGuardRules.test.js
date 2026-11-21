import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDistanceFare,
  correctBookingFare,
  correctCompletedTripFare,
  odometerStepMeters,
} from '../fareGuardRules.js';

// The live Auto price row (Balasore/Bhubaneswar fallback) on 21 Nov 2026.
const AUTO = { base_price: 50, base_distance: 3, price_per_distance: 8, time_price: 2 };

test('formula matches fares the apps produced on live rides', () => {
  assert.equal(Math.round(computeDistanceFare(AUTO, 1390.43, 3.337)), 57);
  assert.equal(Math.round(computeDistanceFare(AUTO, 6510, 15.6)), 109);
  assert.equal(Math.round(computeDistanceFare(AUTO, 7290, 17.5)), 119);
});

test('booking: road distance longer than the pins raises the fare', () => {
  const result = correctBookingFare({
    rule: AUTO,
    clientFare: 57,
    clientDistanceMeters: 1390,
    clientDurationMinutes: 3.34,
    roadDistanceMeters: 11000,
    roadDurationMinutes: 20,
  });
  // 50 + 8 km * 8 + max(3.34, 11*2.4=26.4, 20) * 2 = 166.8, minus the 56.7 the app used, on top of 57.
  assert.ok(result);
  assert.equal(result.distanceMeters, 11000);
  assert.equal(result.fare, Math.round(57 + computeDistanceFare(AUTO, 11000, 26.43) - computeDistanceFare(AUTO, 1390, 3.34)));
  assert.ok(result.fare > 150 && result.fare < 175);
});

test('booking: keeps the app fare when the road is about the same', () => {
  assert.equal(correctBookingFare({ rule: AUTO, clientFare: 57, clientDistanceMeters: 1390, clientDurationMinutes: 3.34, roadDistanceMeters: 1600 }), null);
});

test('booking: never lowers, and keeps a price hike the app added', () => {
  // App already charged 1.5x for the same distance: the correction adds only the distance difference.
  const hiked = correctBookingFare({ rule: AUTO, clientFare: 90, clientDistanceMeters: 5000, clientDurationMinutes: 12, roadDistanceMeters: 6000 });
  assert.ok(hiked.fare > 90);
  assert.equal(correctBookingFare({ rule: AUTO, clientFare: 500, clientDistanceMeters: 5000, clientDurationMinutes: 12, roadDistanceMeters: 4000 }), null);
});

test('booking: missing rule, bad fare or no route leaves the booking alone', () => {
  assert.equal(correctBookingFare({ rule: null, clientFare: 57, clientDistanceMeters: 1390, roadDistanceMeters: 11000 }), null);
  assert.equal(correctBookingFare({ rule: AUTO, clientFare: 'x', clientDistanceMeters: 1390, roadDistanceMeters: 11000 }), null);
  assert.equal(correctBookingFare({ rule: AUTO, clientFare: 57, clientDistanceMeters: 1390, roadDistanceMeters: null }), null);
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
