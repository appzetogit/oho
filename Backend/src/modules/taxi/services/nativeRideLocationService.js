import { readCachedValue, setCachedValue } from '../../../utils/cache.js';
import { SOCKET_EVENTS } from '../socket/events.js';
import { updateDriverRoute } from '../socket/services/driverRouteService.js';
import { getSocketServer } from './dispatchService.js';
import { mirrorRideDriverLocation } from './rideRealtimeSyncService.js';
import {
  DRIVER_LOCATION_CACHE_TTL_MS,
  driverLocationCacheKey,
  getActiveRideForIdentity,
  getRideRoom,
  updateRideDriverLocation,
} from './rideService.js';

// The driver app's live trip position normally arrives over its socket. When
// the driver swipes the app away mid-trip that socket dies with it, and the
// rider's map froze on the last point. The native location service keeps
// posting to POST /drivers/location; this forwards those fixes to the ride the
// same way the socket handler does.

// A socket fix newer than this means the app is alive and streaming its own,
// richer fixes (sequence, heading); a native one in between would only jitter.
const SOCKET_FIX_FRESH_MS = 8000;
// Same rule as the socket handler: a vague fix must not replace a good one.
const MAX_ACCURACY_METERS = 60;
const ACTIVE_RIDE_CACHE_MS = 30_000;

const activeRideByDriver = new Map();

const findActiveRideId = async (driverId) => {
  const key = String(driverId);
  const cached = activeRideByDriver.get(key);
  if (cached && Date.now() - cached.at < ACTIVE_RIDE_CACHE_MS) {
    return cached.rideId;
  }
  const ride = await getActiveRideForIdentity({ role: 'driver', entityId: key });
  const rideId = ride?._id ? String(ride._id) : null;
  activeRideByDriver.set(key, { rideId, at: Date.now() });
  return rideId;
};

export const forwardNativeLocationToRide = async ({ driverId, coordinates, heading, speed, accuracy }) => {
  const rideId = await findActiveRideId(driverId);
  if (!rideId) {
    return;
  }

  const cacheKey = driverLocationCacheKey(rideId);
  const cached = await readCachedValue(cacheKey).catch(() => null);
  const cachedAgeMs = cached?.updatedAt ? Date.now() - new Date(cached.updatedAt).getTime() : Infinity;
  if (cached && cached.source !== 'native' && cachedAgeMs < SOCKET_FIX_FRESH_MS) {
    return;
  }

  const incomingAccuracy = Number.isFinite(Number(accuracy)) ? Number(accuracy) : null;
  if (cached && incomingAccuracy !== null && incomingAccuracy > MAX_ACCURACY_METERS) {
    return;
  }

  let locationUpdate;
  try {
    locationUpdate = await updateRideDriverLocation({ rideId, driverId, coordinates, heading, speed });
  } catch (error) {
    // Ride ended or was reassigned since we looked it up.
    activeRideByDriver.delete(String(driverId));
    return;
  }

  setCachedValue(
    cacheKey,
    {
      coordinates,
      heading: locationUpdate.heading ?? null,
      speed: locationUpdate.speed ?? null,
      updatedAt: new Date().toISOString(),
      source: 'native',
    },
    { ttlMs: DRIVER_LOCATION_CACHE_TTL_MS },
  ).catch(() => {});

  const io = getSocketServer();
  io?.to(getRideRoom(rideId)).emit(SOCKET_EVENTS.RIDE_DRIVER_LOCATION_UPDATED, {
    ...locationUpdate,
    ...(incomingAccuracy !== null ? { accuracy: incomingAccuracy } : {}),
    timestamp: Date.now(),
  });

  mirrorRideDriverLocation({
    rideId,
    coordinates: locationUpdate.coordinates,
    heading: locationUpdate.heading,
    speed: locationUpdate.speed,
  }).catch(() => {});

  if (io) {
    updateDriverRoute({ io, rideId, driverId: String(driverId), coordinates });
  }
};
