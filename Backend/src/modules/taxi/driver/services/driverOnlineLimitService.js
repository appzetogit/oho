import { Driver } from '../models/Driver.js';
import { getDriverRoom, getSocketServer } from '../../services/dispatchService.js';
import { sendPushNotificationToEntities } from '../../services/pushNotificationService.js';
import {
  buildDriverTodaySummaryFromDocument,
  mergeOnlineSessionIntoTracking,
} from './driverTodaySummaryService.js';

/// A driver may stay on duty for at most this long in one stretch; after it
/// they are taken offline and have to go online again themselves.
const MAX_ONLINE_HOURS = Number(process.env.DRIVER_MAX_ONLINE_HOURS) > 0
  ? Number(process.env.DRIVER_MAX_ONLINE_HOURS)
  : 12;
export const MAX_ONLINE_MS = MAX_ONLINE_HOURS * 60 * 60 * 1000;

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

let sweepTimer = null;

const pruneClaimedRewards = (items = []) =>
  (Array.isArray(items) ? items : [])
    .filter((item) => item?.rewardType && item?.rewardKey)
    .sort((left, right) => new Date(left.claimedAt || 0) - new Date(right.claimedAt || 0))
    .slice(-200);

/// Drivers past the limit. A driver on a trip is left alone until it ends -
/// cutting them off mid-ride would strand the rider - and is picked up by the
/// first sweep after it.
///
/// Drivers who went online before `onlineSessionStartedAt` existed fall back
/// to the incentive tracker's session start.
const overLimitFilter = (cutoff) => ({
  isOnline: true,
  isOnRide: { $ne: true },
  $or: [
    { onlineSessionStartedAt: { $lte: cutoff } },
    {
      onlineSessionStartedAt: null,
      'incentiveTracking.currentOnlineStartedAt': { $lte: cutoff },
    },
  ],
});

const forceDriverOffline = async (driver, now) => {
  const finalizedTracking = mergeOnlineSessionIntoTracking(
    driver.incentiveTracking || {},
    driver.incentiveTracking?.currentOnlineStartedAt,
    now,
  );
  const finalizedTodaySummary = buildDriverTodaySummaryFromDocument(driver, { now });

  // Conditional on still being online and off-trip: with several API
  // instances each running this sweep, only the one whose update lands
  // notifies the driver, and a ride accepted in between is never cut off.
  const result = await Driver.updateOne(
    { _id: driver._id, isOnline: true, isOnRide: { $ne: true } },
    {
      $set: {
        isOnline: false,
        socketId: null,
        onlineSessionStartedAt: null,
        incentiveTracking: {
          ...finalizedTracking,
          currentOnlineStartedAt: null,
          claimedRewards: pruneClaimedRewards(finalizedTracking?.claimedRewards),
        },
        todaySummary: finalizedTodaySummary,
      },
    },
  );

  if (!result.modifiedCount) return false;

  const message = `You were online for more than ${MAX_ONLINE_HOURS} hours, so you have been taken offline. Take a break and go online again when you are ready.`;

  getSocketServer()?.to(getDriverRoom(driver._id)).emit('driver:forced_offline', {
    reason: 'max_online_hours',
    maxOnlineHours: MAX_ONLINE_HOURS,
    message,
  });

  sendPushNotificationToEntities({
    driverIds: [driver._id],
    title: 'You are now offline',
    body: message,
    data: { type: 'driver_forced_offline', reason: 'max_online_hours' },
  }).catch((error) => {
    console.error('[online-limit] push failed for driver', String(driver._id), error);
  });

  return true;
};

export const takeOverLimitDriversOffline = async () => {
  const now = new Date();
  const cutoff = new Date(now.getTime() - MAX_ONLINE_MS);
  const drivers = await Driver.find(overLimitFilter(cutoff))
    .select('_id incentiveTracking todaySummary')
    .limit(500)
    .lean();

  let count = 0;
  for (const driver of drivers) {
    try {
      if (await forceDriverOffline(driver, now)) count += 1;
    } catch (error) {
      console.error('[online-limit] could not take driver offline', String(driver._id), error);
    }
  }
  if (count) console.log(`[online-limit] took ${count} driver(s) offline after ${MAX_ONLINE_HOURS}h online`);
  return count;
};

export const startDriverOnlineLimitLoop = () => {
  if (sweepTimer) return;
  const run = () => {
    takeOverLimitDriversOffline().catch((error) => {
      console.error('[online-limit] sweep failed', error);
    });
  };
  run();
  sweepTimer = setInterval(run, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
};
