import { appliesToDriver, parsePhones, phoneListProblem } from '../../milestones/services/milestoneRules.js';

/**
 * The rules for the company's per-ride top-up, with no database, so they can be
 * tested on their own. The rider's fare isn't involved: this is money the
 * company adds to the driver's wallet on top of what the rider paid.
 *
 *   Bike ₹20 a ride:   { amount_per_ride: 20, amount_per_km: 0, max_per_ride: 0 }
 *   Auto ₹5 + ₹3/km:   { amount_per_ride: 5, amount_per_km: 3, max_per_ride: 40 }
 */

const money = (value) => Math.max(0, Math.round((Number(value) || 0) * 100) / 100);

export const normalizeIncentiveSettings = (raw = {}) => ({
  enabled: Boolean(raw.enabled),
  rates: (Array.isArray(raw.rates) ? raw.rates : [])
    .filter((rate) => rate?.vehicleTypeId)
    .map((rate) => ({
      vehicleTypeId: String(rate.vehicleTypeId),
      amount_per_ride: money(rate.amount_per_ride),
      amount_per_km: money(rate.amount_per_km),
      max_per_ride: money(rate.max_per_ride),
    })),
  max_rides_per_driver_per_day: Math.floor(Math.max(0, Number(raw.max_rides_per_driver_per_day ?? 10) || 0)),
  min_distance_km: Math.max(0, Number(raw.min_distance_km ?? 1) || 0),
  only_driver_phones: parsePhones(raw.only_driver_phones),
});

/** Why these settings can't be saved, or '' if they're fine. */
export const incentiveSettingsProblem = (settings, rawPhones) => {
  const phones = phoneListProblem('Only these drivers', rawPhones);
  if (phones) return phones;
  if (settings.enabled && !settings.rates.some((rate) => rate.amount_per_ride > 0 || rate.amount_per_km > 0)) {
    return 'Set an amount for at least one vehicle before switching this on';
  }
  return '';
};

export const incentiveAmount = (rate, distanceMeters) => {
  if (!rate) return 0;
  const km = Math.max(0, Number(distanceMeters) || 0) / 1000;
  const amount = rate.amount_per_ride + rate.amount_per_km * km;
  return money(rate.max_per_ride > 0 ? Math.min(amount, rate.max_per_ride) : amount);
};

/**
 * Should this completed ride earn the top-up? `paidToday` is how many this
 * driver has already had today. `reason` is what the admin sees when it doesn't.
 */
export const decideIncentive = ({ settings, ride, driver, paidToday = 0 }) => {
  const skip = (reason) => ({ pay: false, amount: 0, reason });

  if (String(ride.serviceType || 'ride') !== 'ride') return skip('not a normal ride');
  if (driver?.approve !== true || driver?.status !== 'approved' || driver?.deletedAt) return skip('driver not approved');
  if (!appliesToDriver(settings, driver.phone)) return skip('driver not on the test list');

  const rate = settings.rates.find((item) => item.vehicleTypeId === String(ride.vehicleTypeId || ''));
  const amount = incentiveAmount(rate, ride.estimatedDistanceMeters);
  if (amount <= 0) return skip('no amount set for this vehicle');

  if (settings.min_distance_km > 0
    && (Number(ride.estimatedDistanceMeters) || 0) < settings.min_distance_km * 1000) {
    return skip('ride too short');
  }
  if (settings.max_rides_per_driver_per_day > 0 && paidToday >= settings.max_rides_per_driver_per_day) {
    return skip('daily limit reached');
  }

  return { pay: true, amount, reason: '' };
};
