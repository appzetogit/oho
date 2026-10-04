import { normalizePoint } from '../../../../utils/geo.js';
import { RIDE_LIVE_STATUS } from '../../constants/index.js';
import { getDriverRoom } from '../../services/dispatchService.js';
import {
  appendRideMessage,
  getActiveRideForIdentity,
  getRideDetails,
  getRideRoom,
  serializeRideRealtime,
  updateRideDriverLocation,
  updateRideLifecycle,
} from '../../services/rideService.js';
import {
  mirrorRideDriverLocation,
  mirrorRideRealtimeState,
} from '../../services/rideRealtimeSyncService.js';
import { authorizeRideRoomAccess } from '../middleware/rideRoomAuth.js';
import { SOCKET_EVENTS } from '../events.js';
import { clearDriverRoute, updateDriverRoute } from '../services/driverRouteService.js';
import { consumeScopedRateLimit } from '../../middlewares/rateLimitMiddleware.js';
import { setCachedValue } from '../../../../utils/cache.js';
import { DRIVER_LOCATION_CACHE_TTL_MS, driverLocationCacheKey } from '../../services/rideService.js';

const driverLifecycleStatuses = new Set([
  RIDE_LIVE_STATUS.ACCEPTED,
  RIDE_LIVE_STATUS.ARRIVING,
  RIDE_LIVE_STATUS.STARTED,
  RIDE_LIVE_STATUS.ARRIVED,
  RIDE_LIVE_STATUS.COMPLETED,
]);
const RIDE_LOCATION_PERSIST_MIN_DISTANCE_METERS = 12;
const RIDE_LOCATION_PERSIST_MAX_INTERVAL_MS = 4000;
// Above this, a new fix is too vague to be worth overwriting a better one
// already on file - except the first fix of a trip, which always goes through.
const RIDE_LOCATION_MAX_ACCURACY_METERS = 60;
const RIDE_LOCATION_RATE_LIMIT_MAX = 60;
const RIDE_LOCATION_RATE_LIMIT_WINDOW_MS = 10000;
const rideLocationPersistState = new Map();

const toRadians = (value) => Number(value || 0) * (Math.PI / 180);

const getDistanceMeters = (first = [], second = []) => {
  const [firstLng, firstLat] = first;
  const [secondLng, secondLat] = second;

  if (![firstLng, firstLat, secondLng, secondLat].every((value) => Number.isFinite(Number(value)))) {
    return Number.POSITIVE_INFINITY;
  }

  const earthRadiusMeters = 6371000;
  const deltaLat = toRadians(Number(secondLat) - Number(firstLat));
  const deltaLng = toRadians(Number(secondLng) - Number(firstLng));
  const startLat = toRadians(firstLat);
  const endLat = toRadians(secondLat);
  const haversine = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(deltaLng / 2) ** 2;

  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
};

export const registerRideSocketHandlers = ({ io, socket, onAsync }) => {
  const emitRideState = (ride) => {
    const payload = serializeRideRealtime(ride);
    io.to(getRideRoom(ride._id)).emit(SOCKET_EVENTS.RIDE_STATE, payload);
    setImmediate(() => {
      mirrorRideRealtimeState(payload).catch(() => {});
    });
    return payload;
  };

  socket.on(
    SOCKET_EVENTS.RIDE_JOIN,
    onAsync(socket, async ({ rideId }) => {
      if (!rideId) {
        throw new Error('rideId is required');
      }

      const ride = await authorizeRideRoomAccess({ socket, rideId });
      const room = getRideRoom(ride._id);
      socket.join(room);

      socket.emit(SOCKET_EVENTS.RIDE_JOINED, {
        rideId: String(ride._id),
        room,
      });

      const activeRide = await getActiveRideForIdentity({
        role: socket.auth.role,
        entityId: socket.auth.sub,
      });

      if (activeRide && String(activeRide._id) === String(ride._id)) {
        const payload = serializeRideRealtime(activeRide);
        socket.emit(SOCKET_EVENTS.RIDE_STATE, payload);
        setImmediate(() => {
          mirrorRideRealtimeState(payload).catch(() => {});
        });
      }
    }),
  );

  socket.on(
    SOCKET_EVENTS.RIDE_REJOIN_CURRENT,
    onAsync(socket, async () => {
      const ride = await getActiveRideForIdentity({
        role: socket.auth.role,
        entityId: socket.auth.sub,
      });

      if (!ride) {
        socket.emit(SOCKET_EVENTS.RIDE_STATE, null);
        return;
      }

      const room = getRideRoom(ride._id);
      socket.join(room);
      socket.emit(SOCKET_EVENTS.RIDE_JOINED, {
        rideId: String(ride._id),
        room,
        rejoined: true,
      });
      const payload = serializeRideRealtime(ride);
      socket.emit(SOCKET_EVENTS.RIDE_STATE, payload);
      setImmediate(() => {
        mirrorRideRealtimeState(payload).catch(() => {});
      });
    }),
  );

  socket.on(
    SOCKET_EVENTS.RIDE_DRIVER_LOCATION_UPDATE,
    onAsync(socket, async ({ rideId, coordinates, heading, speed, accuracy, timestamp, sequence }) => {
      if (socket.auth.role !== 'driver') {
        throw new Error('Only drivers can update live ride location');
      }

      await authorizeRideRoomAccess({ socket, rideId });

      // Server self-protection, not correctness: a driver app sending faster
      // than this is misbehaving, and dropping the excess costs nothing.
      const rateLimitOutcome = await consumeScopedRateLimit({
        scope: 'ride_driver_location_socket',
        max: RIDE_LOCATION_RATE_LIMIT_MAX,
        windowMs: RIDE_LOCATION_RATE_LIMIT_WINDOW_MS,
        mode: 'custom',
        parts: [String(socket.auth.sub)],
      });
      if (!rateLimitOutcome.allowed) return;

      const normalizedCoordinates = normalizePoint(coordinates, 'coordinates');
      const persistKey = `${rideId}:${socket.auth.sub}`;
      const now = Date.now();
      const previousPersistState = rideLocationPersistState.get(persistKey) || {};
      const hasPreviousFix = Array.isArray(previousPersistState.coordinates);

      // Reject an out-of-order packet before touching the database or telling
      // anyone about it. A late packet has to be invisible everywhere - the
      // rider, the driver's own second device, any admin map - and all of them
      // read from whatever gets past this point.
      const incomingSequence = Number.isFinite(Number(sequence)) ? Number(sequence) : null;
      const lastSequence = Number.isFinite(Number(previousPersistState.sequence))
        ? Number(previousPersistState.sequence)
        : null;
      if (incomingSequence !== null && lastSequence !== null && incomingSequence <= lastSequence) {
        return;
      }

      // Only once there is an earlier, better fix worth keeping. The very first
      // fix of a trip goes through however vague it is; refusing it would leave
      // the rider's map empty until the phone gets a clean lock.
      const incomingAccuracy = Number.isFinite(Number(accuracy)) ? Number(accuracy) : null;
      if (incomingAccuracy !== null && hasPreviousFix
        && incomingAccuracy > RIDE_LOCATION_MAX_ACCURACY_METERS) {
        return;
      }

      const distanceFromPrevious = hasPreviousFix
        ? getDistanceMeters(previousPersistState.coordinates, normalizedCoordinates)
        : Number.POSITIVE_INFINITY;
      const shouldPersistLocation = !hasPreviousFix ||
        distanceFromPrevious >= RIDE_LOCATION_PERSIST_MIN_DISTANCE_METERS ||
        now - Number(previousPersistState.persistedAt || 0) >= RIDE_LOCATION_PERSIST_MAX_INTERVAL_MS;
      const fallbackLocationUpdate = {
        rideId: String(rideId),
        coordinates: normalizedCoordinates,
        heading: Number.isFinite(Number(heading)) ? Number(heading) : null,
        speed: Number.isFinite(Number(speed)) ? Number(speed) : null,
        updatedAt: new Date().toISOString(),
      };
      const locationUpdate = shouldPersistLocation
        ? await updateRideDriverLocation({
            rideId,
            driverId: socket.auth.sub,
            coordinates: normalizedCoordinates,
            heading,
            speed,
          })
        : fallbackLocationUpdate;

      // Passed through untouched and never persisted: these exist purely so the
      // rider client can run its own ordering and plausibility checks. An older
      // driver build that does not send them simply omits the fields, which the
      // rider treats as "nothing to compare against" - backward compatible by
      // construction.
      // Refreshed on every accepted fix regardless of the persist throttle: a
      // REST read needs the driver's true latest position, not whatever was
      // last written to the slower store. Fire-and-forget - a cache that is
      // down must never hold up the live broadcast.
      setCachedValue(
        driverLocationCacheKey(rideId),
        {
          coordinates: normalizedCoordinates,
          heading: locationUpdate.heading ?? null,
          speed: locationUpdate.speed ?? null,
          updatedAt: new Date().toISOString(),
        },
        { ttlMs: DRIVER_LOCATION_CACHE_TTL_MS },
      ).catch(() => {});

      io.to(getRideRoom(rideId)).emit(SOCKET_EVENTS.RIDE_DRIVER_LOCATION_UPDATED, {
        ...locationUpdate,
        ...(incomingAccuracy !== null ? { accuracy: incomingAccuracy } : {}),
        ...(Number.isFinite(Number(timestamp)) ? { timestamp: Number(timestamp) } : {}),
        ...(incomingSequence !== null ? { sequence: incomingSequence } : {}),
      });
      if (shouldPersistLocation) {
        setImmediate(() => {
          mirrorRideDriverLocation({
            rideId,
            coordinates: locationUpdate.coordinates,
            heading: locationUpdate.heading,
            speed: locationUpdate.speed,
          }).catch(() => {});
        });
      }

      rideLocationPersistState.set(persistKey, {
        coordinates: normalizedCoordinates,
        persistedAt: shouldPersistLocation ? now : Number(previousPersistState.persistedAt || 0),
        sequence: incomingSequence ?? lastSequence,
      });

      updateDriverRoute({
        io,
        rideId,
        driverId: socket.auth.sub,
        coordinates: normalizedCoordinates,
      });
    }),
  );

  socket.on(
    SOCKET_EVENTS.RIDE_STATUS_UPDATE,
    onAsync(socket, async ({ rideId, status, paymentMethod, otp }) => {
      if (socket.auth.role !== 'driver') {
        throw new Error('Only drivers can update ride status');
      }

      if (!driverLifecycleStatuses.has(status)) {
        throw new Error('Unsupported ride status transition');
      }

      await authorizeRideRoomAccess({ socket, rideId });

      const ride = await updateRideLifecycle({
        rideId,
        driverId: socket.auth.sub,
        nextStatus: status,
        paymentMethod,
        otp,
      });
      const populatedRide = await getRideDetails(rideId);

      const payload = {
        rideId: String(populatedRide._id),
        status: populatedRide.status,
        liveStatus: populatedRide.liveStatus,
        acceptedAt: populatedRide.acceptedAt,
        arrivedAt: populatedRide.arrivedAt,
        startedAt: populatedRide.startedAt,
        completedAt: populatedRide.completedAt,
      };

      io.to(getRideRoom(rideId)).emit(SOCKET_EVENTS.RIDE_STATUS_UPDATED, payload);
      emitRideState(populatedRide);

      if (status === RIDE_LIVE_STATUS.COMPLETED) {
        const walletUpdate = ride.$locals?.walletUpdate;
        if (walletUpdate) {
          io.to(getDriverRoom(socket.auth.sub)).emit('driver:wallet:updated', {
            wallet: walletUpdate.wallet,
            transaction: walletUpdate.transaction,
            earningTransaction: walletUpdate.earningTransaction,
            commissionTransaction: walletUpdate.commissionTransaction,
          });
        }
        clearDriverRoute(socket.auth.sub);
        rideLocationPersistState.delete(`${rideId}:${socket.auth.sub}`);
      }
    }),
  );

  socket.on(
    SOCKET_EVENTS.RIDE_MESSAGE_SEND,
    onAsync(socket, async ({ rideId, message }) => {
      await authorizeRideRoomAccess({ socket, rideId });

      const savedMessage = await appendRideMessage({
        rideId,
        role: socket.auth.role,
        senderId: socket.auth.sub,
        message,
      });

      io.to(getRideRoom(rideId)).emit(SOCKET_EVENTS.RIDE_MESSAGE_NEW, savedMessage);
    }),
  );
};
