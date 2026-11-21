/**
 * Pure fare rules used to correct a ride's fare on the server.
 *
 * The apps work out the fare themselves and send it with the booking. They
 * measure the straight line between the pins, not the road, and nothing used to
 * reprice a trip that ran far longer than booked: a 10 km Auto trip was billed
 * as the 1.4 km straight line between its pins.
 *
 * These rules only ever RAISE a fare, by the difference between the admin's
 * price for the real distance and the price for the distance the app used. So
 * whatever the app already folded in (price hikes, rounding) is kept, an
 * unchanged installed app keeps working, and a fare is never lowered.
 *
 * The formula matches what the apps compute (checked against 60 live rides):
 *   base_price + max(0, km - base_distance) * price_per_distance + minutes * time_price
 */

/** Minutes per km the apps assume when they estimate a trip (~25 km/h). */
export const DEFAULT_MINUTES_PER_KM = 2.4;

/** Road routes shorter than this over the app's estimate are left alone. */
export const BOOKING_MIN_EXTRA_METERS = 300;

/** A tracked trip must beat the booked distance by this much AND this ratio. */
export const TRIP_MIN_EXTRA_METERS = 1000;
export const TRIP_MIN_RATIO = 1.25;

/** GPS runaway guard: never bill more than this beyond the booked distance. */
export const TRIP_MAX_EXTRA_METERS = 40000;

/** Odometer filters for successive driver fixes during a trip. */
export const ODOMETER_MIN_STEP_METERS = 10;
export const ODOMETER_MAX_STEP_METERS = 3000;
export const ODOMETER_MAX_SPEED_MPS = 42; // ~150 km/h
export const ODOMETER_MAX_GAP_STEP_METERS = 30000;

const num = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const haversineMeters = (first = [], second = []) => {
  const [lng1, lat1] = first.map(Number);
  const [lng2, lat2] = second.map(Number);
  if (![lng1, lat1, lng2, lat2].every(Number.isFinite)) return null;

  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

/** True when a set-price row carries the distance-based fields we need. */
export const isDistancePricingRule = (rule) =>
  Boolean(rule) && (num(rule.price_per_distance) > 0 || num(rule.time_price) > 0 || num(rule.base_price) > 0);

/** The admin's ride price for a distance and duration, unrounded. */
export const computeDistanceFare = (rule, distanceMeters, durationMinutes) => {
  const km = Math.max(0, num(distanceMeters)) / 1000;
  const minutes = Math.max(0, num(durationMinutes));
  return num(rule?.base_price)
    + Math.max(0, km - num(rule?.base_distance)) * num(rule?.price_per_distance)
    + minutes * num(rule?.time_price);
};

/** Minutes per km the app assumed for this ride, or the default. */
export const minutesPerKmFrom = (distanceMeters, durationMinutes) => {
  const km = num(distanceMeters) / 1000;
  const minutes = num(durationMinutes);
  if (km > 0.2 && minutes > 0) {
    const ratio = minutes / km;
    if (ratio >= 0.5 && ratio <= 10) return ratio;
  }
  return DEFAULT_MINUTES_PER_KM;
};

/**
 * Fare correction at booking, from the road distance.
 *
 * Returns null when nothing should change. Otherwise the corrected fare and the
 * distance/duration to store with the ride.
 */
export const correctBookingFare = ({
  rule,
  clientFare,
  clientDistanceMeters,
  clientDurationMinutes,
  roadDistanceMeters,
  roadDurationMinutes,
}) => {
  const fare = num(clientFare, NaN);
  const road = num(roadDistanceMeters, NaN);
  if (!isDistancePricingRule(rule) || !Number.isFinite(fare) || !Number.isFinite(road) || road <= 0) {
    return null;
  }

  const appDistance = Math.max(0, num(clientDistanceMeters));
  if (road < appDistance + BOOKING_MIN_EXTRA_METERS) {
    return null;
  }

  const appMinutes = Math.max(0, num(clientDurationMinutes));
  const pace = minutesPerKmFrom(appDistance, appMinutes);
  const roadMinutesAtAppPace = (road / 1000) * pace;
  const minutes = Math.max(appMinutes, roadMinutesAtAppPace, num(roadDurationMinutes));

  const extra = computeDistanceFare(rule, road, minutes) - computeDistanceFare(rule, appDistance, appMinutes);
  const correctedFare = Math.round(fare + Math.max(0, extra));
  if (correctedFare <= fare) {
    return null;
  }

  return {
    fare: correctedFare,
    distanceMeters: Math.round(road),
    durationMinutes: Number(minutes.toFixed(2)),
  };
};

/**
 * Distance to add to a trip's odometer for one new driver fix, or 0.
 *
 * Drops GPS jitter (tiny steps) and teleports (huge steps, impossible speed).
 */
export const odometerStepMeters = ({ previousCoordinates, previousAt, nextCoordinates, nextAt }) => {
  const step = haversineMeters(previousCoordinates || [], nextCoordinates || []);
  if (step === null || step < ODOMETER_MIN_STEP_METERS) {
    return 0;
  }

  // With a known time gap, an implausible speed is the teleport test, so a
  // driver whose app went quiet for a few minutes still gets that stretch.
  // Without one, only a short step is trusted.
  const seconds = (new Date(nextAt).getTime() - new Date(previousAt).getTime()) / 1000;
  if (Number.isFinite(seconds) && seconds > 0) {
    return step / seconds > ODOMETER_MAX_SPEED_MPS || step > ODOMETER_MAX_GAP_STEP_METERS ? 0 : step;
  }

  return step > ODOMETER_MAX_STEP_METERS ? 0 : step;
};

/**
 * Fare correction at the end of a trip, from the distance actually driven.
 *
 * Only for plain rides whose fare is the admin price: no promo, subscription or
 * driver bidding, whose fare is a separate agreement this must not disturb.
 */
export const correctCompletedTripFare = ({ ride, rule }) => {
  if (!ride || !isDistancePricingRule(rule)) return null;
  if (String(ride.serviceType || 'ride') !== 'ride') return null;
  if (String(ride.pricingNegotiationMode || 'none') === 'driver_bid') return null;
  if (String(ride.promo?.code || '').trim() || num(ride.promo?.discount_amount) > 0) return null;
  if (ride.subscriptionUsage?.covered) return null;

  const fare = num(ride.fare, NaN);
  const booked = Math.max(0, num(ride.estimatedDistanceMeters));
  const tracked = Math.max(0, num(ride.tripDistanceMeters));
  if (!Number.isFinite(fare) || tracked <= 0) return null;
  if (tracked < booked + TRIP_MIN_EXTRA_METERS || tracked < booked * TRIP_MIN_RATIO) return null;

  const billable = Math.min(tracked, booked + TRIP_MAX_EXTRA_METERS);
  const bookedMinutes = Math.max(0, num(ride.estimatedDurationMinutes));
  const pace = minutesPerKmFrom(booked, bookedMinutes);
  const minutes = Math.max(bookedMinutes, (billable / 1000) * pace);

  const extra = computeDistanceFare(rule, billable, minutes) - computeDistanceFare(rule, booked, bookedMinutes);
  const correctedFare = Math.round(fare + Math.max(0, extra));
  if (correctedFare <= fare) return null;

  return {
    fare: correctedFare,
    billedDistanceMeters: Math.round(billable),
    billedDurationMinutes: Number(minutes.toFixed(2)),
  };
};
