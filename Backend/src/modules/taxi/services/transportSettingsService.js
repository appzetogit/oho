import { createDefaultBusinessSettings } from '../admin/data/defaultBusinessSettings.js';
import { AdminBusinessSetting } from '../admin/models/AdminBusinessSetting.js';
import { getOrLoadCachedValue } from '../../../utils/cache.js';

const defaultTransportRideSettings = createDefaultBusinessSettings().transport_ride || {};
const defaultBidRideSettings = createDefaultBusinessSettings().bid_ride || {};
const defaultCustomizationSettings = createDefaultBusinessSettings().customization || {};
const SETTINGS_CACHE_TTL_MS = 30_000;

export const CUSTOMIZATION_SETTINGS_CACHE_KEY = 'cache:settings:customization';

const toPositiveNumber = (value, fallback) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : fallback;
};

export const getTransportRideSettings = async () => {
  return getOrLoadCachedValue(
    'cache:settings:transport_ride',
    {
      ttlMs: SETTINGS_CACHE_TTL_MS,
      load: async () => {
        const businessSettings = await AdminBusinessSetting.findOne({ scope: 'default' })
          .select('transport_ride')
          .lean();

        return {
          ...defaultTransportRideSettings,
          ...(businessSettings?.transport_ride || {}),
        };
      },
    },
  );
};

export const getBidRideSettings = async () => {
  return getOrLoadCachedValue(
    'cache:settings:bid_ride',
    {
      ttlMs: SETTINGS_CACHE_TTL_MS,
      load: async () => {
        const businessSettings = await AdminBusinessSetting.findOne({ scope: 'default' })
          .select('bid_ride')
          .lean();

        return {
          ...defaultBidRideSettings,
          ...(businessSettings?.bid_ride || {}),
        };
      },
    },
  );
};

export const getCustomizationSettings = async () => {
  return getOrLoadCachedValue(
    CUSTOMIZATION_SETTINGS_CACHE_KEY,
    {
      ttlMs: SETTINGS_CACHE_TTL_MS,
      load: async () => {
        const businessSettings = await AdminBusinessSetting.findOne({ scope: 'default' })
          .select('customization')
          .lean();

        return {
          ...defaultCustomizationSettings,
          ...(businessSettings?.customization || {}),
        };
      },
    },
  );
};

/**
 * Admin toggles arrive as the strings '1'/'0' (the panel posts them that way),
 * but older documents may hold real booleans, so accept both. Anything absent
 * falls back to the default rather than reading as "off", which would silently
 * drop a safety check on installs that predate the setting.
 */
const isSettingEnabled = (value, fallback) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(normalized);
};

/**
 * Whether a driver must capture a daily selfie before going online.
 */
export const isDriverOnlineSelfieRequired = async () => {
  const settings = await getCustomizationSettings();
  return isSettingEnabled(
    settings.enable_driver_online_selfie,
    isSettingEnabled(defaultCustomizationSettings.enable_driver_online_selfie, true),
  );
};

export const resolveTransportDispatchConfig = async () => {
  const settings = await getTransportRideSettings();
  const driverSearchRadiusKm = toPositiveNumber(
    settings.driver_search_radius,
    toPositiveNumber(defaultTransportRideSettings.driver_search_radius, 5),
  );
  const retryWindowSeconds = toPositiveNumber(
    settings.trip_accept_reject_duration_for_driver,
    toPositiveNumber(defaultTransportRideSettings.trip_accept_reject_duration_for_driver, 15),
  );
  const maxSearchSeconds = toPositiveNumber(
    settings.maximum_time_for_find_drivers_for_regular_ride,
    toPositiveNumber(defaultTransportRideSettings.maximum_time_for_find_drivers_for_regular_ride, 300),
  );

  return {
    settings,
    dispatchType: String(settings.trip_dispatch_type || defaultTransportRideSettings.trip_dispatch_type) === '2'
      ? 'broadcast'
      : 'one_by_one',
    baseDistanceMeters: Math.round(driverSearchRadiusKm * 1000),
    maxDistanceMeters: Math.round(driverSearchRadiusKm * 1000),
    retryWindowSeconds,
    retryDelayMs: Math.round(retryWindowSeconds * 1000),
    maxSearchSeconds,
    maxAttempts: Math.max(1, Math.ceil(maxSearchSeconds / retryWindowSeconds)),
  };
};
