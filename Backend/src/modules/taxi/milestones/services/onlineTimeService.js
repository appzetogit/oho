import { DriverOnlineDay } from '../models/DriverOnlineDay.js';
import { toIstDayKey } from './milestoneRules.js';

/**
 * A gap longer than this between two contacts from the app means it stopped
 * talking to us (closed, phone off, no signal), and that time doesn't count.
 * The app polls every few seconds, so a short signal drop still counts.
 */
export const MAX_COUNTED_GAP_MS = 5 * 60 * 1000;

/** The seconds to credit for the gap between two heartbeats. */
export const countedSeconds = ({ wasOnline, previousSeenAt, now }) => {
  if (!wasOnline || !previousSeenAt) return 0;
  const gapMs = new Date(now).getTime() - new Date(previousSeenAt).getTime();
  if (gapMs <= 0 || gapMs > MAX_COUNTED_GAP_MS) return 0;
  return gapMs / 1000;
};

/**
 * Adds the time since this driver's previous heartbeat to today's total.
 *
 * `previous` must be the values read atomically as lastSeenAt was overwritten.
 * Each worker heartbeats separately, and this way every stretch of time belongs
 * to exactly one heartbeat, so nothing is counted twice.
 */
export const recordDriverOnlineTime = async (driverId, previous, now = new Date()) => {
  const seconds = countedSeconds({
    wasOnline: previous?.isOnline,
    previousSeenAt: previous?.lastSeenAt,
    now,
  });
  if (!seconds) return;

  const write = () => DriverOnlineDay.updateOne(
    { driverId, day: toIstDayKey(now) },
    { $inc: { seconds } },
    { upsert: true },
  );

  try {
    await write();
  } catch (error) {
    // Two workers creating today's row at once: the loser adds to the winner's.
    if (error?.code !== 11000) throw error;
    await write();
  }
};
