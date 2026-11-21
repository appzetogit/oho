/**
 * Ride fares worked out on the server, from the admin price list.
 *
 * The apps used to work out the fare themselves, on the straight line between
 * the pins, and the server took whatever number they sent. Now:
 * - at booking the fare is exactly the price list for the ROAD distance (any
 *   active price hike included), whatever the app sent, up or down;
 * - at completion a trip that ran well beyond its booked distance pays the
 *   price-list difference for the extra distance.
 *
 * Formula, matching the OHO rider app (checked against 60 live rides):
 *   subtotal = base_price + max(0, km - base_distance) * price_per_distance + minutes * time_price
 *   fare     = round(subtotal + subtotal * service_tax / 100)
 */

/** Minutes per km the apps assume when they estimate a trip (~25 km/h). */
export const DEFAULT_MINUTES_PER_KM = 2.4;

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

/** The admin's ride price for a distance and duration, unrounded, tax included. */
export const computeDistanceFare = (rule, distanceMeters, durationMinutes) => {
  const km = Math.max(0, num(distanceMeters)) / 1000;
  const minutes = Math.max(0, num(durationMinutes));
  const subtotal = num(rule?.base_price)
    + Math.max(0, km - num(rule?.base_distance)) * num(rule?.price_per_distance)
    + minutes * num(rule?.time_price);
  return subtotal + (subtotal * Math.max(0, num(rule?.service_tax))) / 100;
};

/** The price-list fare in whole rupees. */
export const computeListFare = (rule, distanceMeters, durationMinutes) =>
  Math.max(0, Math.round(computeDistanceFare(rule, distanceMeters, durationMinutes)));

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

/** Copy of a price row with a price hike applied to its money fields. */
export const applyHike = (rule, multiplier) => {
  const m = num(multiplier, 1);
  if (!rule || !(m > 1)) return rule;
  const round2 = (value) => Math.round((num(value) + Number.EPSILON) * 100) / 100;
  return {
    ...rule,
    base_price: round2(num(rule.base_price) * m),
    price_per_distance: round2(num(rule.price_per_distance) * m),
    time_price: round2(num(rule.time_price) * m),
  };
};

/** A city ride booked as a round trip (the app sends intercity.tripType). */
export const isRoundTripIntercity = (intercity) =>
  String(intercity?.tripType || '').trim().toLowerCase() === 'round_trip';

/** Stops the app sent, as routing waypoints ("lat,lng|lat,lng"), or ''. */
export const stopsToWaypoints = (stops) => {
  if (!Array.isArray(stops)) return '';
  return stops
    .map((stop) => [num(stop?.lat, NaN), num(stop?.lng, NaN)])
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng)
      && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)
    .slice(0, 8)
    .map(([lat, lng]) => `${lat},${lng}`)
    .join('|');
};

/**
 * The booking fare: exactly the price list for the distance.
 *
 * Distance is the road route (through any stops) or, when that is unavailable
 * or shorter, the distance the app measured through its stops: the road is
 * never shorter than the straight lines between the same points, so the longer
 * of the two is the better measure. Minutes follow the app's pace (about 2.4
 * min/km). A round trip charges both legs, the base fare once, as the app does.
 * Returns null only when the ride cannot be priced (no usable price row, no
 * distance); the app's fare is then kept.
 */
export const priceBookingFare = ({
  rule,
  clientDistanceMeters,
  clientDurationMinutes,
  roadDistanceMeters,
  roundTrip = false,
}) => {
  if (!isDistancePricingRule(rule)) return null;

  const appDistance = Math.max(0, num(clientDistanceMeters));
  const road = num(roadDistanceMeters, NaN);
  const usedRoad = Number.isFinite(road) && road > 0 && road >= appDistance;
  const distance = usedRoad ? road : appDistance;
  if (!(distance > 0)) return null;

  const pace = minutesPerKmFrom(appDistance, clientDurationMinutes);
  const minutes = (distance / 1000) * pace;
  const legs = roundTrip ? 2 : 1;
  const fare = computeListFare(rule, distance * legs, minutes * legs);
  if (!(fare > 0)) return null;

  // Stored one way, as the app sends it: drivers and history show the route.
  return {
    fare,
    distanceMeters: Math.round(distance),
    durationMinutes: Number(minutes.toFixed(2)),
    source: usedRoad ? 'road' : 'app_distance',
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
 * Adds the price-list difference between the distance driven and the distance
 * booked, so a rider's own fare raise (user bidding) is kept. Only for plain
 * rides: no promo, subscription or driver bidding, whose fare is a separate
 * agreement this must not disturb.
 */
export const correctCompletedTripFare = ({ ride, rule }) => {
  if (!ride || !isDistancePricingRule(rule)) return null;
  if (String(ride.serviceType || 'ride') !== 'ride') return null;
  if (String(ride.pricingNegotiationMode || 'none') === 'driver_bid') return null;
  if (String(ride.promo?.code || '').trim() || num(ride.promo?.discount_amount) > 0) return null;
  if (ride.subscriptionUsage?.covered) return null;

  // A round trip is booked one way but driven both ways.
  const legs = isRoundTripIntercity(ride.intercity) ? 2 : 1;
  const fare = num(ride.fare, NaN);
  const booked = Math.max(0, num(ride.estimatedDistanceMeters)) * legs;
  const tracked = Math.max(0, num(ride.tripDistanceMeters));
  if (!Number.isFinite(fare) || tracked <= 0) return null;
  if (tracked < booked + TRIP_MIN_EXTRA_METERS || tracked < booked * TRIP_MIN_RATIO) return null;

  const hikedRule = applyHike(rule, ride.pricingSnapshot?.priceHikeMultiplier);
  const billable = Math.min(tracked, booked + TRIP_MAX_EXTRA_METERS);
  const bookedMinutes = Math.max(0, num(ride.estimatedDurationMinutes)) * legs;
  const pace = minutesPerKmFrom(booked, bookedMinutes);
  const minutes = Math.max(bookedMinutes, (billable / 1000) * pace);

  const extra = computeDistanceFare(hikedRule, billable, minutes) - computeDistanceFare(hikedRule, booked, bookedMinutes);
  const correctedFare = Math.round(fare + Math.max(0, extra));
  if (correctedFare <= fare) return null;

  return {
    fare: correctedFare,
    billedDistanceMeters: Math.round(billable),
    billedDurationMinutes: Number(minutes.toFixed(2)),
  };
};
