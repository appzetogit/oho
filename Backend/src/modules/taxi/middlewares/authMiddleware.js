import { Admin } from '../admin/models/Admin.js';
import { Owner } from '../admin/models/Owner.js';
import { ServiceStore } from '../admin/models/ServiceStore.js';
import { ServiceCenterStaff } from '../admin/models/ServiceCenterStaff.js';
import { ApiError } from '../../../utils/ApiError.js';
import { Driver } from '../driver/models/Driver.js';
import { BusDriver } from '../driver/models/BusDriver.js';
import { PoolingVehicle } from '../admin/models/PoolingVehicle.js';
import { User } from '../user/models/User.js';
import { verifyAccessToken } from '../services/tokenService.js';
import {
  normalizeAdminPermissions,
  normalizeAdminType,
} from '../admin/services/adminAccessService.js';

const roleModelMap = {
  admin: Admin,
  'super-admin': Admin,
  driver: Driver,
  pooling_driver: PoolingVehicle,
  bus_driver: BusDriver,
  owner: Owner,
  service_center: ServiceStore,
  service_center_staff: ServiceCenterStaff,
  user: User,
};

const normalizeRole = (role = '') => {
  const value = String(role || '').toLowerCase();
  if (value === 'super-admin') {
    return 'admin';
  }
  return value;
};

/**
 * Stamp lastSeenAt for a driver, at most once a minute each.
 *
 * Drivers poll several endpoints while on duty, so writing on every request
 * would be a lot of pointless database traffic. A minute is far finer than the
 * staleness window the admin panel judges against, and the write is fire and
 * forget: a failed heartbeat must never break the request it rode in on.
 */
const DRIVER_HEARTBEAT_INTERVAL_MS = 60 * 1000;
const lastSeenWrites = new Map();

const touchDriverLastSeen = (driverId) => {
  const key = String(driverId);
  const now = Date.now();
  const previous = lastSeenWrites.get(key) || 0;
  if (now - previous < DRIVER_HEARTBEAT_INTERVAL_MS) return;
  lastSeenWrites.set(key, now);

  // Keep the map from growing without bound on a long-lived worker.
  if (lastSeenWrites.size > 5000) {
    for (const [id, at] of lastSeenWrites) {
      if (now - at > DRIVER_HEARTBEAT_INTERVAL_MS * 10) lastSeenWrites.delete(id);
    }
  }

  Driver.updateOne({ _id: driverId }, { $set: { lastSeenAt: new Date(now) } })
    .catch((error) => console.warn('[presence] could not record last seen:', error.message));
};

const attachResolvedAuth = (req, payload) => {
  req.auth = {
    sub: payload.sub,
    role: normalizeRole(payload.role),
    originalRole: payload.role,
  };
};

export const authenticate = (allowedRoles = [], options = {}) => async (req, _res, next) => {
  try {
    const allowPending = options?.allowPending === true;
    const authorization = req.headers.authorization || '';
    const [, token] = authorization.split(' ');

    if (!token) {
      throw new ApiError(401, 'Authorization token is required');
    }

    const payload = verifyAccessToken(token);

    const normalizedRole = normalizeRole(payload.role);
    const normalizedAllowedRoles = allowedRoles.map(normalizeRole);

    if (normalizedAllowedRoles.length > 0 && !normalizedAllowedRoles.includes(normalizedRole)) {
      throw new ApiError(403, 'Insufficient permissions for this resource');
    }

    const Model = roleModelMap[payload.role] || roleModelMap[normalizedRole];

    if (!Model) {
      throw new ApiError(401, 'Unsupported auth role');
    }

    const entity = await Model.findById(payload.sub);

    if (!entity) {
      throw new ApiError(401, 'Authenticated account no longer exists');
    }

    // Server-side sign-out. Reported as 'jwt expired' on purpose: that is the
    // exact message the apps already treat as "session over, log in again",
    // so a forced logout needs no app update.
    if (entity.tokensValidAfter && Number(payload.iat) * 1000 < new Date(entity.tokensValidAfter).getTime()) {
      throw new ApiError(401, 'jwt expired');
    }

    if (
      normalizedRole === 'user' &&
      (entity.deletedAt || entity.isActive === false || entity.active === false)
    ) {
      throw new ApiError(401, 'User account is not active');
    }

    if (
      normalizedRole === 'driver' &&
      !allowPending &&
      (entity.approve === false || String(entity.status || '').toLowerCase() === 'pending')
    ) {
      throw new ApiError(403, 'Driver account is pending approval');
    }

    if (
      normalizedRole === 'owner' &&
      !allowPending &&
      (entity.active === false ||
        entity.approve === false ||
        String(entity.status || '').toLowerCase() === 'pending')
    ) {
      throw new ApiError(403, 'Owner account is pending approval');
    }

    if (
      normalizedRole === 'bus_driver' &&
      !allowPending &&
      (entity.active === false ||
        entity.approve === false ||
        ['pending', 'blocked'].includes(String(entity.status || '').toLowerCase()))
    ) {
      throw new ApiError(403, 'Bus driver account is pending approval');
    }

    if (
      normalizedRole === 'pooling_driver' &&
      !allowPending &&
      (entity.approve === false || String(entity.status || '').toLowerCase() === 'pending')
    ) {
      throw new ApiError(403, 'Pooling driver account is pending approval');
    }

    if (
      normalizedRole === 'pooling_driver' &&
      (entity.poolingEnabled === false ||
        ['inactive', 'maintenance'].includes(String(entity.status || '').toLowerCase()))
    ) {
      throw new ApiError(403, 'Pooling driver account is inactive');
    }

    if (
      normalizedRole === 'service_center' &&
      !allowPending &&
      (entity.active === false ||
        entity.approve === false ||
        String(entity.status || '').toLowerCase() === 'inactive')
    ) {
      throw new ApiError(403, 'Service center account is inactive');
    }

    if (
      normalizedRole === 'service_center_staff' &&
      !allowPending &&
      (entity.active === false ||
        entity.approve === false ||
        String(entity.status || '').toLowerCase() === 'inactive')
    ) {
      throw new ApiError(403, 'Service center staff account is inactive');
    }

    attachResolvedAuth(req, payload);
    req.auth.entity = entity;

    // Remember that this driver's app spoke to us just now. Nothing else
    // recorded it: isOnline was set when a driver went on duty and then never
    // cleared, so 117 drivers who had not opened the app in weeks — some in
    // months — still counted as online in God's Eye. With a timestamp, "online"
    // can mean "said hello recently" instead of "once pressed a button".
    if (normalizedRole === 'driver') {
      touchDriverLastSeen(entity._id);
    }

    if (normalizedRole === 'admin') {
      req.auth.admin = {
        id: String(entity._id),
        email: entity.email || '',
        name: entity.name || '',
        role: entity.role || '',
        admin_type: normalizeAdminType(entity.admin_type || entity.role),
        permissions: normalizeAdminPermissions(entity.permissions || []),
        service_location_ids: Array.isArray(entity.service_location_ids)
          ? entity.service_location_ids.map((item) => String(item))
          : [],
        zone_ids: Array.isArray(entity.zone_ids)
          ? entity.zone_ids.map((item) => String(item))
          : [],
        active: entity.active !== false,
        status: entity.status || 'active',
      };

      if (req.auth.admin.active === false || String(req.auth.admin.status).toLowerCase() === 'inactive') {
        throw new ApiError(403, 'Admin account is inactive');
      }
    }

    next();
  } catch (error) {
    next(error);
  }
};
