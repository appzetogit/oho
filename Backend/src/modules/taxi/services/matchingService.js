import { ApiError } from '../../../utils/ApiError.js';
import { normalizePoint } from '../../../utils/geo.js';
import { DISPATCH_TOP_DRIVERS } from '../constants/index.js';
import { Vehicle } from '../admin/models/Vehicle.js';
import { Driver } from '../driver/models/Driver.js';
import { Zone } from '../driver/models/Zone.js';
import { getDriverIdsBlockedByUpcomingScheduledRides } from './rideService.js';
import { getDriverOrderWalletRule } from '../driver/services/walletService.js';
import mongoose from 'mongoose';

const EARTH_RADIUS_METERS = 6371000;

const normalizeVehicleKey = (value = '') => String(value || '').trim().toLowerCase();

const normalizeVehicleKeys = (vehicles = []) => {
  const keys = vehicles.flatMap((vehicle) => [
    vehicle?.name,
    vehicle?.vehicle_type,
    vehicle?.icon_types,
    String(vehicle?.name || '').replace(/\s+/g, '_'),
    String(vehicle?.icon_types || '').replace(/\s+/g, '_'),
  ]);

  return [...new Set(keys.map(normalizeVehicleKey).filter(Boolean))];
};

const normalizeVehicleTypeIds = (vehicleTypeIds = [], vehicleTypeId = null) => {
  const values = Array.isArray(vehicleTypeIds) ? vehicleTypeIds : [vehicleTypeIds];

  if (vehicleTypeId) {
    values.push(vehicleTypeId);
  }

  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
};

const buildDriverMatchFilters = ({ zoneId, serviceLocationId, vehicleTypeId, vehicleTypeIds, vehicleTypeKeys, walletRule }) => {
  const normalizedVehicleTypeIds = normalizeVehicleTypeIds(vehicleTypeIds, vehicleTypeId);
  const normalizedVehicleTypeKeys = Array.isArray(vehicleTypeKeys)
    ? [...new Set(vehicleTypeKeys.map(normalizeVehicleKey).filter(Boolean))]
    : [];
  const vehicleTypeClauses = normalizedVehicleTypeIds.length
    ? [{ vehicleTypeId: { $in: normalizedVehicleTypeIds } }]
    : [
        ...(normalizedVehicleTypeKeys.length
          ? [
              { vehicleType: { $in: normalizedVehicleTypeKeys } },
              { vehicleIconType: { $in: normalizedVehicleTypeKeys } },
            ]
          : []),
      ];
  // Fleet drivers are paid through their owner, so the wallet minimum doesn't
  // apply to them (accepting skips it too). Everyone else must meet the live
  // minimum; the stored isBlocked flag can be days out of date.
  const minimum = Number(walletRule?.minimumBalanceForOrders ?? 0);
  const walletClauses = walletRule?.isWalletEnabled === false
    ? []
    : [
        { 'wallet.balance': { $gte: minimum } },
        ...(minimum <= 0 ? [{ 'wallet.balance': { $exists: false } }] : []),
      ];

  // The wallet rule and the vehicle type can both be an $or. Spread into one
  // object, the vehicle $or replaced the wallet one, so drivers below the
  // wallet minimum were matched whenever the vehicle was picked by name.
  // With the wallet switched off there is no wallet clause at all (an $or of
  // just "fleet driver" would have left out every independent driver).
  const andClauses = [
    ...(walletClauses.length ? [{ $or: [{ owner_id: { $ne: null } }, ...walletClauses] }] : []),
    ...(vehicleTypeClauses.length > 1 ? [{ $or: vehicleTypeClauses }] : []),
  ];

  return {
    isOnline: true,
    isOnRide: false,
    // Disapproved or deleted drivers must stop getting offers straight away,
    // not when they next go offline.
    approve: true,
    deletedAt: null,
    ...(andClauses.length ? { $and: andClauses } : {}),
    ...(zoneId ? { zoneId } : {}),
    ...(serviceLocationId ? { service_location_id: serviceLocationId } : {}),
    ...(vehicleTypeClauses.length === 1 ? vehicleTypeClauses[0] : {}),
  };
};

const buildZoneIntersectionQuery = (coordinates) => ({
  active: { $ne: false },
  status: { $ne: 'inactive' },
  geometry: {
    $geoIntersects: {
      $geometry: {
        type: 'Point',
        coordinates,
      },
    },
  },
});

export const findZoneByPickup = async (pickupCoords, options = {}) => {
  const coordinates = normalizePoint(pickupCoords, 'pickupCoords');
  const normalizedServiceLocationId = String(options?.serviceLocationId || '').trim();

  if (normalizedServiceLocationId) {
    const preferredZone = await Zone.findOne({
      ...buildZoneIntersectionQuery(coordinates),
      service_location_id: normalizedServiceLocationId,
    }).sort({ updatedAt: -1, createdAt: -1 });

    if (preferredZone) {
      return preferredZone;
    }
  }

  // Zones are authoritative for dispatch. If polygons overlap, prefer the newest active zone.
  return Zone.findOne(buildZoneIntersectionQuery(coordinates)).sort({ updatedAt: -1, createdAt: -1 });
};

const toLocalMeters = (origin, target) => {
  const [originLng, originLat] = origin;
  const [targetLng, targetLat] = target;
  const originLatRadians = (originLat * Math.PI) / 180;
  const metersPerDegreeLat = (Math.PI * EARTH_RADIUS_METERS) / 180;
  const metersPerDegreeLng = metersPerDegreeLat * Math.cos(originLatRadians);

  return {
    x: (targetLng - originLng) * metersPerDegreeLng,
    y: (targetLat - originLat) * metersPerDegreeLat,
  };
};

const getDistanceToSegmentMeters = (origin, segmentStart, segmentEnd) => {
  const start = toLocalMeters(origin, segmentStart);
  const end = toLocalMeters(origin, segmentEnd);
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const segmentLengthSquared = (segmentX * segmentX) + (segmentY * segmentY);

  if (segmentLengthSquared <= 0) {
    return Math.hypot(start.x, start.y);
  }

  const projection = Math.max(
    0,
    Math.min(1, -((start.x * segmentX) + (start.y * segmentY)) / segmentLengthSquared),
  );
  const closestX = start.x + (projection * segmentX);
  const closestY = start.y + (projection * segmentY);

  return Math.hypot(closestX, closestY);
};

const getZoneBoundaryCapMeters = (zone, pickupCoords) => {
  const ring = Array.isArray(zone?.geometry?.coordinates?.[0]) ? zone.geometry.coordinates[0] : [];

  if (ring.length < 3) {
    return null;
  }

  let shortestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < ring.length - 1; index += 1) {
    const segmentStart = normalizePoint(ring[index], `zone.geometry.coordinates[0][${index}]`);
    const segmentEnd = normalizePoint(ring[index + 1], `zone.geometry.coordinates[0][${index + 1}]`);
    const distanceMeters = getDistanceToSegmentMeters(pickupCoords, segmentStart, segmentEnd);

    if (Number.isFinite(distanceMeters) && distanceMeters < shortestDistance) {
      shortestDistance = distanceMeters;
    }
  }

  return Number.isFinite(shortestDistance) ? Math.max(0, Math.round(shortestDistance)) : null;
};

const getDistanceBetweenMeters = (origin, target) => {
  const [originLng, originLat] = origin;
  const [targetLng, targetLat] = target;

  const dLat = ((targetLat - originLat) * Math.PI) / 180;
  const dLng = ((targetLng - originLng) * Math.PI) / 180;
  const lat1 = (originLat * Math.PI) / 180;
  const lat2 = (targetLat * Math.PI) / 180;

  const a =
    (Math.sin(dLat / 2) ** 2) +
    (Math.cos(lat1) * Math.cos(lat2) * (Math.sin(dLng / 2) ** 2));

  return Math.round(2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

// Where the driver is now. A route-booking driver's saved pin is where they
// want to go, not where they are: matching from the pin offered rides to
// drivers kilometres away from the pickup.
const getDriverMatchCoordinates = (driver = {}) => {
  if (Array.isArray(driver?.location?.coordinates) && driver.location.coordinates.length === 2) {
    return normalizePoint(driver.location.coordinates, 'driver.location.coordinates');
  }

  return null;
};

const isPointInsidePolygonRing = (point, ring = []) => {
  if (!Array.isArray(ring) || ring.length < 3) {
    return false;
  }

  const [pointLng, pointLat] = point;
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [lng1, lat1] = normalizePoint(ring[i], `zone.geometry.coordinates[0][${i}]`);
    const [lng2, lat2] = normalizePoint(ring[j], `zone.geometry.coordinates[0][${j}]`);
    const intersects =
      ((lat1 > pointLat) !== (lat2 > pointLat)) &&
      (pointLng < ((lng2 - lng1) * (pointLat - lat1)) / ((lat2 - lat1) || Number.EPSILON) + lng1);

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
};

const isDriverWithinMatchedZone = (driver, zone) => {
  if (!zone?._id) {
    return true;
  }

  const coordinates = getDriverMatchCoordinates(driver);
  if (!coordinates) {
    return false;
  }

  const ring = Array.isArray(zone?.geometry?.coordinates?.[0]) ? zone.geometry.coordinates[0] : [];
  if (!ring.length) {
    return String(driver?.zoneId || '') === String(zone._id);
  }

  return isPointInsidePolygonRing(coordinates, ring);
};

const filterDriversForMatchedZone = ({ drivers = [], zone = null, pickupCoords, maxDistance }) =>
  drivers.filter((driver) => {
    const coordinates = getDriverMatchCoordinates(driver);
    if (!coordinates) {
      return false;
    }

    if (!isDriverWithinMatchedZone(driver, zone)) {
      return false;
    }

    if (Number.isFinite(maxDistance) && maxDistance > 0) {
      return getDistanceBetweenMeters(pickupCoords, coordinates) <= maxDistance;
    }

    return true;
  });

// A driver's live location counts for matching only this long after the phone
// last sent it. Past it the position is a guess: a driver who went online at
// home and drove 8 km kept getting offers for home.
//
// SWITCHED OFF (null) until most drivers run the driver app that keeps sending
// location while the phone is locked (flutterdriver e0e5b85 or later). The
// build in drivers' hands today stops sending when locked, so on 21 Nov this
// rule left 13 of 17 online drivers unable to get any ride. Turn it back on
// with 10 * 60 * 1000 once that build is widely installed.
//
// Switched on from Backend/.env without a code change:
// DRIVER_LOCATION_MAX_AGE_MS=<milliseconds> (e.g. 180000 = 3 minutes).
// Unset or 0 = off. Read on every search, so a pm2 reload --update-env applies it.
export const getDriverLocationMaxAgeMs = () => {
  const ms = Number(process.env.DRIVER_LOCATION_MAX_AGE_MS);
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms) : null;
};

const locationFreshnessFilter = () => {
  const maxAgeMs = getDriverLocationMaxAgeMs();
  return maxAgeMs
    ? { locationUpdatedAt: { $gte: new Date(Date.now() - maxAgeMs) } }
    : {};
};

const buildGeoNearFilter = (field, coordinates, maxDistance) => ({
  [field]: {
    $near: {
      $geometry: {
        type: 'Point',
        coordinates,
      },
      $maxDistance: maxDistance,
    },
  },
});

// $centerSphere takes radians: metres / Earth's radius.
const buildGeoWithinFilter = (field, coordinates, maxDistance) => ({
  [field]: {
    $geoWithin: {
      $centerSphere: [coordinates, maxDistance / EARTH_RADIUS_METERS],
    },
  },
});

// Nearest first, by where the driver is now.
const sortDriversByDispatchAnchorDistance = (drivers = [], pickupCoords) =>
  [...drivers]
    .map((driver) => {
      const coordinates = getDriverMatchCoordinates(driver);
      return {
        driver,
        distanceMeters: coordinates
          ? getDistanceBetweenMeters(pickupCoords, coordinates)
          : Number.POSITIVE_INFINITY,
      };
    })
    .sort((left, right) => left.distanceMeters - right.distanceMeters)
    .map(({ driver }) => driver);

const findDriversForZone = async ({
  zoneId,
  serviceLocationId,
  coordinates,
  effectiveMaxDistance,
  limit,
  normalizedVehicleTypeIds,
  vehicleTypeKeys,
  strictZoneOnly = false,
  excludeDriverIds = [],
  walletRule,
}) => {
  const commonFilters = {
    ...buildDriverMatchFilters({
      zoneId,
      serviceLocationId,
      vehicleTypeIds: normalizedVehicleTypeIds,
      vehicleTypeKeys,
      walletRule,
    }),
    // Drivers already offered this ride, or who turned it down, are left out
    // before the nearest-N limit. Filtering them afterwards meant every retry
    // got the same few drivers back and nobody further away was ever tried.
    ...(excludeDriverIds.length
      ? {
          _id: {
            $nin: excludeDriverIds
              .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
              .map((id) => new mongoose.Types.ObjectId(String(id))),
          },
        }
      : {}),
  };
  const selectedFields =
    'name phone socketId vehicleTypeId vehicleType vehicleIconType vehicleNumber vehicleColor vehicleMake vehicleModel rating location zoneId service_location_id isOnline isOnRide routeBooking';

  const [liveLocationDrivers, routeBookingDrivers] = await Promise.all([
    Driver.find({
      ...commonFilters,
      'routeBooking.enabled': { $ne: true },
      ...locationFreshnessFilter(),
      ...(strictZoneOnly ? {} : buildGeoNearFilter('location', coordinates, effectiveMaxDistance)),
    })
      .limit(limit)
      .select(selectedFields),
    // Route-booking drivers: where they are now must be within the radius,
    // and so must their saved pin.
    Driver.find({
      ...commonFilters,
      'routeBooking.enabled': true,
      'routeBooking.anchorLocation': { $ne: null },
      'routeBooking.anchorLocation.coordinates.1': { $exists: true },
      ...locationFreshnessFilter(),
      ...(strictZoneOnly
        ? {}
        : {
            ...buildGeoNearFilter('location', coordinates, effectiveMaxDistance),
            ...buildGeoWithinFilter('routeBooking.anchorLocation', coordinates, effectiveMaxDistance),
          }),
    })
      .limit(limit)
      .select(selectedFields),
  ]);

  return sortDriversByDispatchAnchorDistance(
    [...liveLocationDrivers, ...routeBookingDrivers].filter(
      (driver, index, items) => items.findIndex((item) => String(item._id) === String(driver._id)) === index,
    ),
    coordinates,
  ).slice(0, limit);
};

export const matchDrivers = async (pickupCoords, options = {}) => {
  const coordinates = normalizePoint(pickupCoords, 'pickupCoords');
  const {
    maxDistance = 3000,
    limit = DISPATCH_TOP_DRIVERS,
    vehicleTypeId,
    vehicleTypeIds,
    serviceLocationId = null,
    allowCrossZoneFallback = true,
    strictZoneOnly = false,
    excludeDriverIds = [],
  } = options;
  const walletRule = await getDriverOrderWalletRule();
  const normalizedVehicleTypeIds = normalizeVehicleTypeIds(vehicleTypeIds, vehicleTypeId);
  const allowedVehicles = normalizedVehicleTypeIds.length
    ? await Vehicle.find({ _id: { $in: normalizedVehicleTypeIds } }).select('name vehicle_type icon_types').lean()
    : [];
  const vehicleTypeKeys = normalizeVehicleKeys(allowedVehicles);

  const zone = await findZoneByPickup(coordinates, { serviceLocationId });
  const zoneBoundaryCapMeters = zone ? getZoneBoundaryCapMeters(zone, coordinates) : null;
  // The admin's radius as set. It used to be cut down to the distance from the
  // pickup to the zone's edge, so a pickup 300 m inside the boundary searched
  // only 300 m even with 5 km set. Drivers outside the zone are still excluded
  // by the zone check below.
  const effectiveMaxDistance = Math.max(1, Math.round(maxDistance));

  let drivers = await findDriversForZone({
    zoneId: zone?._id || null,
    serviceLocationId,
    coordinates,
    effectiveMaxDistance,
    limit,
    normalizedVehicleTypeIds,
    vehicleTypeKeys,
    strictZoneOnly,
    excludeDriverIds,
    walletRule,
  });
  drivers = filterDriversForMatchedZone({
    drivers,
    zone,
    pickupCoords: coordinates,
    maxDistance: effectiveMaxDistance,
  });

  const blockedDriverIds = await getDriverIdsBlockedByUpcomingScheduledRides(
    drivers.map((driver) => String(driver?._id || '')),
  );
  drivers = drivers.filter((driver) => !blockedDriverIds.has(String(driver?._id || '')));

  if (allowCrossZoneFallback && drivers.length === 0 && zone?._id) {
    drivers = await findDriversForZone({
      zoneId: null,
      serviceLocationId,
      coordinates,
      effectiveMaxDistance,
      limit,
      normalizedVehicleTypeIds,
      vehicleTypeKeys,
      strictZoneOnly,
      excludeDriverIds,
      walletRule,
    });
    drivers = filterDriversForMatchedZone({
      drivers,
      zone: null,
      pickupCoords: coordinates,
      maxDistance: effectiveMaxDistance,
    });

    const fallbackBlockedDriverIds = await getDriverIdsBlockedByUpcomingScheduledRides(
      drivers.map((driver) => String(driver?._id || '')),
    );
    drivers = drivers.filter((driver) => !fallbackBlockedDriverIds.has(String(driver?._id || '')));
  }

  return {
    zone,
    drivers,
    searchRadiusMeters: effectiveMaxDistance,
    zoneBoundaryCapMeters,
  };
};
