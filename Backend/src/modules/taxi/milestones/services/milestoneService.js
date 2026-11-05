import { ApiError } from '../../../../utils/ApiError.js';
import { AdminBusinessSetting } from '../../admin/models/AdminBusinessSetting.js';
import { Driver } from '../../driver/models/Driver.js';
import { applyDriverWalletAdjustment } from '../../driver/services/walletService.js';
import { sendPushNotificationToEntities } from '../../services/pushNotificationService.js';
import { Ride } from '../../user/models/Ride.js';
import { DriverMilestonePayout } from '../models/DriverMilestonePayout.js';
import { DriverOnlineDay } from '../models/DriverOnlineDay.js';
import {
  addDays,
  appliesToDriver,
  evaluateMilestone,
  istDayStart,
  monthOf,
  normalizeMilestone,
  toIstDayKey,
} from './milestoneRules.js';

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
// A driver who reaches the target just before midnight is paid by the first
// sweep after it, so the previous day stays open for this long.
const PREVIOUS_DAY_GRACE_MS = 15 * 60 * 1000;
const COMPLETED_STATUSES = ['completed', 'delivered'];

let sweepTimer = null;
let indexesReady = null;

/**
 * Production runs with autoIndex off, and the unique index is what stops double
 * payments, so no money moves until it definitely exists.
 */
const ensureIndexes = () => {
  indexesReady ??= Promise.all([
    DriverMilestonePayout.createIndexes(),
    DriverOnlineDay.createIndexes(),
  ]).catch((error) => {
    indexesReady = null;
    throw error;
  });
  return indexesReady;
};

const getProgram = async () => {
  const doc = await AdminBusinessSetting.findOne({ scope: 'default' }).select('referral.driver').lean();
  const settings = doc?.referral?.driver || {};
  return {
    enabled: Boolean(settings.milestone_program_enabled),
    milestones: (Array.isArray(settings.milestone_programs) ? settings.milestone_programs : [])
      .map(normalizeMilestone),
  };
};

const isPayable = (driver) => driver?.approve === true && driver?.status === 'approved' && !driver?.deletedAt;

const keyOf = (driverId, value) => `${driverId}:${value}`;

/** Online seconds, trips and payouts for these drivers, from `fromDay` onwards. */
const loadHistory = async (driverIds, fromDay) => {
  const [days, trips, payouts] = await Promise.all([
    DriverOnlineDay.find({ driverId: { $in: driverIds }, day: { $gte: fromDay } })
      .select('driverId day seconds').lean(),
    Ride.aggregate([
      {
        $match: {
          driverId: { $in: driverIds },
          status: { $in: COMPLETED_STATUSES },
          completedAt: { $gte: istDayStart(fromDay) },
        },
      },
      {
        $group: {
          _id: {
            driverId: '$driverId',
            day: { $dateToString: { format: '%Y-%m-%d', date: '$completedAt', timezone: 'Asia/Kolkata' } },
          },
          count: { $sum: 1 },
        },
      },
    ]),
    DriverMilestonePayout.find({ driverId: { $in: driverIds } })
      .select('driverId milestoneId periodKey windowEnd status').lean(),
  ]);

  const seconds = new Map();
  for (const row of days) seconds.set(keyOf(row.driverId, row.day), row.seconds);
  const tripCounts = new Map();
  for (const row of trips) tripCounts.set(keyOf(row._id.driverId, row._id.day), row.count);
  const payoutRows = new Map();
  for (const row of payouts) {
    const key = keyOf(row.driverId, row.milestoneId);
    payoutRows.set(key, [...(payoutRows.get(key) || []), row]);
  }

  return { seconds, tripCounts, payoutRows };
};

const viewFor = (history, driverId) => {
  const prefix = `${driverId}:`;
  const pick = (source) => {
    const result = new Map();
    for (const [key, value] of source) {
      if (key.startsWith(prefix)) result.set(key.slice(prefix.length), value);
    }
    return result;
  };
  return { secondsByDay: pick(history.seconds), tripsByDay: pick(history.tripCounts) };
};

const longestWindow = (milestones) => Math.max(1, ...milestones.map((item) => item.required_days));

/**
 * Pays one period. The row goes in first: if it's already there, someone else
 * paid it and this returns null without touching the wallet.
 */
const payMilestone = async ({ driverId, milestone, result, paidVia }) => {
  await ensureIndexes();

  let row;
  try {
    row = await DriverMilestonePayout.create({
      driverId,
      milestoneId: milestone.id,
      periodKey: result.periodKey,
      windowStart: result.windowStart,
      windowEnd: result.windowEnd,
      amount: milestone.payout_amount,
      paidVia,
      milestoneName: milestone.name,
      requiredHours: milestone.active_hours_per_day,
      requiredDays: milestone.required_days,
      requiredTrips: milestone.min_trips,
      onlineSeconds: Math.round(result.onlineSeconds),
      trips: result.trips,
    });
  } catch (error) {
    if (error?.code === 11000) return null;
    throw error;
  }

  let walletResult;
  try {
    walletResult = await applyDriverWalletAdjustment({
      driverId,
      amount: milestone.payout_amount,
      type: 'adjustment',
      description: `Milestone reward: ${milestone.name}`,
      metadata: {
        source: 'driver_milestone',
        category: 'driver_incentive',
        milestoneId: milestone.id,
        periodKey: result.periodKey,
        payoutId: String(row._id),
      },
    });
  } catch (error) {
    await DriverMilestonePayout.updateOne(
      { _id: row._id },
      { $set: { status: 'failed', error: String(error?.message || error).slice(0, 300) } },
    );
    console.error('[milestones] wallet credit failed', String(driverId), milestone.id, error);
    throw error;
  }

  await DriverMilestonePayout.updateOne(
    { _id: row._id },
    { $set: { status: 'paid', paidAt: new Date(), walletTransactionId: walletResult?.transaction?._id || null } },
  );

  sendPushNotificationToEntities({
    driverIds: [driverId],
    title: `₹${milestone.payout_amount} added to your wallet`,
    body: `You completed "${milestone.name}".`,
    data: { type: 'driver_milestone_reward', milestoneId: milestone.id },
  }).catch((error) => console.error('[milestones] push failed', String(driverId), error));

  return { row, walletResult };
};

/** Pays every automatic milestone that's been earned. Safe to run at any time. */
export const runMilestoneSweep = async (now = new Date()) => {
  // First, even with the program off: online time is recorded either way, and
  // its writes rely on the unique index too.
  await ensureIndexes();

  const program = await getProgram();
  if (!program.enabled) return 0;

  const milestones = program.milestones.filter((item) => item.enabled && item.payout_mode === 'auto');
  if (milestones.length === 0) return 0;

  const today = toIstDayKey(now);
  const inGrace = now.getTime() - istDayStart(today).getTime() < PREVIOUS_DAY_GRACE_MS;
  const days = inGrace ? [addDays(today, -1), today] : [today];

  const [onlineIds, rideIds] = await Promise.all([
    DriverOnlineDay.distinct('driverId', { day: { $in: days } }),
    Ride.distinct('driverId', {
      status: { $in: COMPLETED_STATUSES },
      completedAt: { $gte: istDayStart(days[0]) },
    }),
  ]);
  const candidateIds = [...new Set([...onlineIds, ...rideIds].filter(Boolean).map(String))];
  if (candidateIds.length === 0) return 0;

  const drivers = await Driver.find({ _id: { $in: candidateIds } })
    .select('_id phone approve status deletedAt').lean();
  const payable = drivers.filter(isPayable);
  if (payable.length === 0) return 0;

  const history = await loadHistory(
    payable.map((driver) => driver._id),
    addDays(today, -(longestWindow(milestones) + 1)),
  );

  let paid = 0;
  for (const driver of payable) {
    const { secondsByDay, tripsByDay } = viewFor(history, driver._id);
    for (const milestone of milestones) {
      if (!appliesToDriver(milestone, driver.phone)) continue;
      const key = keyOf(driver._id, milestone.id);

      for (const day of days) {
        const result = evaluateMilestone({
          milestone,
          day,
          secondsByDay,
          tripsByDay,
          payouts: history.payoutRows.get(key) || [],
        });
        if (!result.eligible) continue;

        try {
          const payment = await payMilestone({ driverId: driver._id, milestone, result, paidVia: 'auto' });
          if (payment) paid += 1;
          // Either way this period is taken now, so the next day sees it.
          history.payoutRows.set(key, [
            ...(history.payoutRows.get(key) || []),
            { periodKey: result.periodKey, windowEnd: result.windowEnd, status: 'paid' },
          ]);
        } catch {
          // Already logged and marked failed. One driver mustn't stop the rest.
        }
      }
    }
  }

  if (paid) console.log(`[milestones] paid ${paid} milestone reward(s)`);
  return paid;
};

export const startMilestoneLoop = () => {
  if (sweepTimer) return;
  const run = () => {
    runMilestoneSweep().catch((error) => console.error('[milestones] sweep failed', error));
  };
  run();
  sweepTimer = setInterval(run, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
};

/** What a driver sees: only milestones that apply to them, with progress. */
export const getDriverMilestones = async (driver, now = new Date()) => {
  const program = await getProgram();
  if (!program.enabled) return [];

  const milestones = program.milestones.filter((item) => item.enabled && appliesToDriver(item, driver.phone));
  if (milestones.length === 0) return [];

  const today = toIstDayKey(now);
  const history = await loadHistory([driver._id], addDays(today, -(longestWindow(milestones) + 1)));
  const { secondsByDay, tripsByDay } = viewFor(history, driver._id);

  return milestones.map((milestone) => {
    const result = evaluateMilestone({
      milestone,
      day: today,
      secondsByDay,
      tripsByDay,
      payouts: history.payoutRows.get(keyOf(driver._id, milestone.id)) || [],
    });

    return {
      id: milestone.id,
      name: milestone.name,
      enabled: milestone.enabled,
      repeat: milestone.repeat,
      required_days: milestone.required_days,
      active_hours_per_day: milestone.active_hours_per_day,
      min_trips: milestone.min_trips,
      payout_amount: milestone.payout_amount,
      payout_mode: milestone.payout_mode,
      // Older app versions read these.
      required_weeks: Math.ceil(milestone.required_days / 7),
      min_trips_per_week: milestone.min_trips,
      periodKey: result.periodKey,
      progress: {
        qualifyingDays: result.qualifyingDays,
        targetDays: result.targetDays,
        qualifyingWeeks: Math.floor(result.qualifyingDays / 7),
        targetWeeks: Math.ceil(result.targetDays / 7),
        onlineMinutesToday: Math.floor(result.onlineSeconds / 60),
        requiredMinutesPerDay: Math.round(result.requiredSeconds / 60),
        trips: result.trips,
        requiredTrips: result.requiredTrips,
      },
      // A driver only claims "claim" milestones. Automatic ones just arrive.
      isEligible: result.eligible && milestone.payout_mode === 'claim',
      isClaimed: result.isClaimed,
      paysAutomatically: milestone.payout_mode === 'auto',
    };
  });
};

/** The same shape as the feature rewards in claimedRewards, for the driver's history. */
export const getDriverMilestoneHistory = async (driverId) => {
  const rows = await DriverMilestonePayout.find({ driverId, status: 'paid' })
    .sort({ paidAt: -1 }).limit(200).lean();
  return rows.map((row) => ({
    rewardType: 'milestone',
    rewardKey: row.milestoneId,
    periodKey: row.periodKey,
    amount: row.amount,
    claimedAt: row.paidAt,
    metadata: { label: row.milestoneName },
  }));
};

export const claimDriverMilestone = async ({ driverId, milestoneId, now = new Date() }) => {
  const driver = await Driver.findById(driverId).select('_id phone approve status deletedAt').lean();
  if (!driver) throw new ApiError(404, 'Driver not found');
  if (!isPayable(driver)) throw new ApiError(403, 'Driver account is not approved');

  const program = await getProgram();
  const milestone = program.milestones.find((item) => item.id === milestoneId);
  if (!program.enabled || !milestone || !milestone.enabled || !appliesToDriver(milestone, driver.phone)) {
    throw new ApiError(404, 'Reward not found');
  }
  if (milestone.payout_mode !== 'claim') {
    throw new ApiError(400, 'This reward is paid automatically');
  }

  const today = toIstDayKey(now);
  const history = await loadHistory([driver._id], addDays(today, -(milestone.required_days + 1)));
  const { secondsByDay, tripsByDay } = viewFor(history, driver._id);
  const result = evaluateMilestone({
    milestone,
    day: today,
    secondsByDay,
    tripsByDay,
    payouts: history.payoutRows.get(keyOf(driver._id, milestone.id)) || [],
  });

  if (result.isClaimed) throw new ApiError(400, 'Reward already claimed');
  if (!result.eligible) throw new ApiError(400, 'Reward is not eligible yet');

  const payment = await payMilestone({ driverId: driver._id, milestone, result, paidVia: 'claim' });
  if (!payment) throw new ApiError(400, 'Reward already claimed');

  return {
    wallet: payment.walletResult.wallet,
    transaction: payment.walletResult.transaction,
    claimedReward: {
      rewardType: 'milestone',
      rewardKey: milestone.id,
      amount: milestone.payout_amount,
      periodKey: result.periodKey,
    },
  };
};

/** The admin's view: what's been paid, and anything that needs checking. */
export const listMilestonePayouts = async ({ limit = 50 } = {}, now = new Date()) => {
  const today = toIstDayKey(now);
  const monthStart = istDayStart(`${monthOf(today)}-01`);
  const size = Math.min(200, Math.max(1, Number(limit) || 50));

  const [rows, totals, attention] = await Promise.all([
    DriverMilestonePayout.find().sort({ createdAt: -1 }).limit(size)
      .populate('driverId', 'name phone').lean(),
    DriverMilestonePayout.aggregate([
      { $match: { status: 'paid', paidAt: { $gte: monthStart } } },
      {
        $group: {
          _id: null,
          monthCount: { $sum: 1 },
          monthAmount: { $sum: '$amount' },
          todayCount: { $sum: { $cond: [{ $gte: ['$paidAt', istDayStart(today)] }, 1, 0] } },
          todayAmount: { $sum: { $cond: [{ $gte: ['$paidAt', istDayStart(today)] }, '$amount', 0] } },
        },
      },
    ]),
    DriverMilestonePayout.countDocuments({
      $or: [
        { status: 'failed' },
        // Normally "pending" lasts milliseconds. Older means a crash mid-payment.
        { status: 'pending', createdAt: { $lt: new Date(now.getTime() - 10 * 60 * 1000) } },
      ],
    }),
  ]);

  const summary = totals[0] || {};
  return {
    summary: {
      todayCount: summary.todayCount || 0,
      todayAmount: summary.todayAmount || 0,
      monthCount: summary.monthCount || 0,
      monthAmount: summary.monthAmount || 0,
      needsChecking: attention,
    },
    results: rows.map((row) => ({
      id: String(row._id),
      driverName: row.driverId?.name || '',
      driverPhone: row.driverId?.phone || '',
      milestoneName: row.milestoneName,
      amount: row.amount,
      day: row.windowEnd,
      status: row.status,
      paidVia: row.paidVia,
      onlineMinutes: Math.floor((row.onlineSeconds || 0) / 60),
      trips: row.trips,
      paidAt: row.paidAt,
      createdAt: row.createdAt,
      error: row.error,
    })),
  };
};
