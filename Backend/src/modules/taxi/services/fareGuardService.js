import { resolveRoute } from './routingService.js';
import { getActivePriceHikeMultiplier } from './priceHikeService.js';
import { applyHike, priceBookingFare } from './fareGuardRules.js';

/** The road lookup may not hold up a booking for longer than this. */
const ROUTE_LOOKUP_BUDGET_MS = 3500;

const withBudget = (promise, ms) =>
  Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);

/**
 * The booking fare, worked out here from the admin price list: exactly the
 * price for the road distance, with any price hike in force right now.
 *
 * The app's own fare is not trusted (it was priced on the straight line between
 * the pins, and a modified app could send anything). If the road lookup fails,
 * the app's distance is priced instead, still from the price list. Returns null
 * only when the ride cannot be priced at all, and never throws: the booking
 * then keeps the app's fare exactly as before.
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
    const haveCoords = [pickupLng, pickupLat, dropLng, dropLat].every(Number.isFinite);

    const [route, multiplier] = await Promise.all([
      haveCoords
        ? withBudget(
            resolveRoute({ origin: `${pickupLat},${pickupLng}`, destination: `${dropLat},${dropLng}` }),
            ROUTE_LOOKUP_BUDGET_MS,
          )
        : null,
      getActivePriceHikeMultiplier().catch(() => 1),
    ]);

    const priced = priceBookingFare({
      rule: applyHike(rule, multiplier),
      clientDistanceMeters,
      clientDurationMinutes,
      roadDistanceMeters: route?.distanceMeters,
    });
    if (!priced) return null;

    if (priced.fare !== Math.round(Number(clientFare))) {
      console.info('[fare-guard] booking priced from the price list', {
        appFare: Number(clientFare),
        fare: priced.fare,
        appMeters: Math.round(Number(clientDistanceMeters) || 0),
        meters: priced.distanceMeters,
        source: priced.source,
        hike: multiplier,
      });
    }

    return { ...priced, priceHikeMultiplier: multiplier > 1 ? multiplier : 1 };
  } catch (error) {
    console.warn('[fare-guard] booking pricing skipped:', error?.message || error);
    return null;
  }
};
