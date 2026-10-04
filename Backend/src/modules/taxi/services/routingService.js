import { getOrLoadCachedValue } from '../../../utils/cache.js';
import { ApiError } from '../../../utils/ApiError.js';

/// Routing resolved here rather than on the handset.
///
/// Both apps used to call the public OSRM demo instance directly: no uptime
/// guarantee, no rate limit we control, and every rider's pickup and drop
/// handed to a third party. Answering from here also means the rider and the
/// driver draw the *same* line, because they ask one service instead of each
/// asking their own.
const OSRM_ENDPOINT = 'https://router.project-osrm.org/route/v1/driving';

/// ~110 m. A driver creeping along the same road keeps hitting one key instead
/// of paying for a fresh lookup every few seconds.
const CACHE_COORD_PRECISION = 3;
const ROUTE_CACHE_TTL_MS = 3 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 6000;
const MAX_WAYPOINTS = 8;

const parsePoint = (raw, label) => {
  const parts = String(raw || '').split(',');
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);

  if (parts.length !== 2 || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new ApiError(400, `${label} must be "lat,lng"`);
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new ApiError(400, `${label} is out of range`);
  }

  return { lat, lng };
};

const parseWaypoints = (raw) => {
  const value = String(raw || '').trim();
  if (!value) return [];

  return value
    .split('|')
    .filter(Boolean)
    .slice(0, MAX_WAYPOINTS)
    .map((part, index) => parsePoint(part, `waypoints[${index}]`));
};

const roundForKey = (value) => Number(value).toFixed(CACHE_COORD_PRECISION);

/// Throws rather than returning null on failure, deliberately: the cache
/// stores whatever this resolves to, so a null would pin one bad lookup for
/// the whole TTL. A throw leaves nothing cached and the next call retries.
const fetchFromOsrm = async (points) => {
  const path = points.map((point) => `${point.lng},${point.lat}`).join(';');
  const url = `${OSRM_ENDPOINT}/${path}?overview=full&geometries=polyline`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`routing provider responded ${response.status}`);
    }

    const body = await response.json();
    const route = Array.isArray(body?.routes) ? body.routes[0] : null;
    const polyline = route?.geometry;

    if (typeof polyline !== 'string' || !polyline) {
      throw new Error('routing provider returned no geometry');
    }

    const distance = Number(route.distance);
    const duration = Number(route.duration);

    return {
      polyline,
      distanceMeters: Number.isFinite(distance) ? Math.round(distance) : null,
      durationMinutes: Number.isFinite(duration) ? Number((duration / 60).toFixed(1)) : null,
      provider: 'osrm',
    };
  } finally {
    clearTimeout(timer);
  }
};

/// Resolves the road route, or null when nothing could be resolved.
///
/// Null is a legitimate answer the callers honour: both apps draw an honest
/// straight line while they wait. A synthesised road-shaped path would look
/// authoritative and quietly put the driver marker through buildings.
export const resolveRoute = async ({ origin, destination, waypoints }) => {
  const start = parsePoint(origin, 'origin');
  const end = parsePoint(destination, 'destination');
  const stops = parseWaypoints(waypoints);
  const points = [start, ...stops, end];

  const cacheKey = `route:v1:${points
    .map((point) => `${roundForKey(point.lat)},${roundForKey(point.lng)}`)
    .join(';')}`;

  try {
    return await getOrLoadCachedValue(cacheKey, {
      ttlMs: ROUTE_CACHE_TTL_MS,
      load: () => fetchFromOsrm(points),
    });
  } catch (error) {
    console.warn('[routing] could not resolve route:', error?.message || error);
    return null;
  }
};
