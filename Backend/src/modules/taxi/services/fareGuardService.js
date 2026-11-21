import { resolveRoute } from './routingService.js';
import { correctBookingFare } from './fareGuardRules.js';

/** The road lookup may not hold up a booking for longer than this. */
const ROUTE_LOOKUP_BUDGET_MS = 3500;

const withBudget = (promise, ms) =>
  Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);

/**
 * Raises a booking's fare to the admin price for the ROAD distance, when the app
 * priced it on a shorter distance (the straight line between the pins).
 *
 * Never throws and never lowers a fare: a routing outage, a missing price rule
 * or anything unexpected leaves the booking exactly as the app sent it.
 */
export const resolveServerCheckedFare = async ({
  rule,
  pickupCoords,
  dropCoords,
  clientFare,
  clientDistanceMeters,
  clientDurationMinutes,
}) => {
  try {
    const [pickupLng, pickupLat] = (pickupCoords || []).map(Number);
    const [dropLng, dropLat] = (dropCoords || []).map(Number);
    if (![pickupLng, pickupLat, dropLng, dropLat].every(Number.isFinite)) return null;

    const route = await withBudget(
      resolveRoute({ origin: `${pickupLat},${pickupLng}`, destination: `${dropLat},${dropLng}` }),
      ROUTE_LOOKUP_BUDGET_MS,
    );
    if (!route?.distanceMeters) return null;

    const correction = correctBookingFare({
      rule,
      clientFare,
      clientDistanceMeters,
      clientDurationMinutes,
      roadDistanceMeters: route.distanceMeters,
      roadDurationMinutes: route.durationMinutes,
    });

    if (correction) {
      console.info('[fare-guard] booking fare raised', {
        from: Number(clientFare),
        to: correction.fare,
        appMeters: Math.round(Number(clientDistanceMeters) || 0),
        roadMeters: correction.distanceMeters,
      });
    }

    return correction;
  } catch (error) {
    console.warn('[fare-guard] booking check skipped:', error?.message || error);
    return null;
  }
};
