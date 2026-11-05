import mongoose from 'mongoose';
import { ApiError } from '../../../../utils/ApiError.js';
import { Vehicle } from '../../admin/models/Vehicle.js';
import { Driver } from '../../driver/models/Driver.js';
import { applyDriverWalletAdjustment, estimateRideCommission } from '../../driver/services/walletService.js';
import { monthOf, toIstDayKey } from '../../milestones/services/milestoneRules.js';
import { sendPushNotificationToEntities } from '../../services/pushNotificationService.js';
import { Ride } from '../../user/models/Ride.js';
import { RideIncentivePayout } from '../models/RideIncentivePayout.js';
import { RideIncentiveSettings } from '../models/RideIncentiveSettings.js';
import {
  decideIncentive,
  incentiveSettingsProblem,
  normalizeIncentiveSettings,
} from './incentiveRules.js';

// Rides are paid as they complete. This only catches any that were missed, for
// example if the server restarted at that exact moment.
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const SWEEP_LOOKBACK_MS = 24 * 60 * 60 * 1000;

let sweepTimer = null;
let indexesReady = null;

/** Production runs with autoIndex off, and the unique index stops double payments. */
const ensureIndexes = () => {
  indexesReady ??= RideIncentivePayout.createIndexes().catch((error) => {
    indexesReady = null;
    throw error;
  });
  return indexesReady;
};

const getSettings = async () => {
  const existing = await RideIncentiveSettings.findOne({ key: 'ride_incentive' }).lean();
  return existing || { enabled: false, rates: [], max_rides_per_driver_per_day: 10, min_distance_km: 1, only_driver_phones: [] };
};

const serializeSettings = (settings) => ({
  ...normalizeIncentiveSettings(settings),
  startsAt: settings.startsAt || null,
});

export const getIncentiveAdminView = async () => {
  const [settings, vehicles] = await Promise.all([
    getSettings(),
    Vehicle.find({ active: true, transport_type: { $in: ['taxi', 'both'] } }).select('name').sort({ name: 1 }).lean(),
  ]);
  return {
    settings: serializeSettings(settings),
    vehicles: vehicles.map((item) => ({ id: String(item._id), name: item.name })),
  };
};

export const updateIncentiveSettings = async (payload = {}, adminId = '') => {
  const next = normalizeIncentiveSettings(payload);
  const problem = incentiveSettingsProblem(next, payload.only_driver_phones);
  if (problem) throw new ApiError(400, problem);

  const current = await getSettings();
  const switchingOn = next.enabled && !current.enabled;

  await ensureIndexes();
  const saved = await RideIncentiveSettings.findOneAndUpdate(
    { key: 'ride_incentive' },
    {
      $set: {
        ...next,
        updatedBy: String(adminId || ''),
        ...(switchingOn ? { startsAt: new Date() } : {}),
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).lean();

  return serializeSettings(saved);
};

/**
 * What each of these drivers would earn on this ride, for showing on the offer.
 * Uses the same rules as the payment. Returns driverId -> amount, leaving out
 * drivers who would get nothing, and nothing at all while it's switched off.
 */
export const estimateRideIncentives = async (ride, driverIds = []) => {
  const amounts = new Map();
  const settings = await getSettings();
  if (!settings.enabled || driverIds.length === 0) return amounts;

  const [drivers, paidRows] = await Promise.all([
    Driver.find({ _id: { $in: driverIds } }).select('phone approve status deletedAt').lean(),
    RideIncentivePayout.aggregate([
      {
        $match: {
          driverId: { $in: driverIds.map((id) => new mongoose.Types.ObjectId(String(id))) },
          day: toIstDayKey(),
          status: { $in: ['pending', 'paid'] },
        },
      },
      { $group: { _id: '$driverId', count: { $sum: 1 } } },
    ]),
  ]);

  const paidToday = new Map(paidRows.map((row) => [String(row._id), row.count]));
  const rules = normalizeIncentiveSettings(settings);
  for (const driver of drivers) {
    const decision = decideIncentive({
      settings: rules,
      ride,
      driver,
      paidToday: paidToday.get(String(driver._id)) || 0,
    });
    if (decision.pay) amounts.set(String(driver._id), decision.amount);
  }
  return amounts;
};

/**
 * The numbers an offer needs, for each of these drivers who'd earn an incentive:
 * the incentive itself, and the commission that comes off, so the app can show
 * what the driver really keeps. Commission is only sent alongside an incentive,
 * so rides without one look exactly as they always have.
 */
export const estimateOfferEarnings = async (ride, driverIds = []) => {
  const earnings = new Map();
  const incentives = await estimateRideIncentives(ride, driverIds);
  if (incentives.size === 0) return earnings;

  const estimatedCommission = await estimateRideCommission(ride);
  for (const [driverId, companyIncentive] of incentives) {
    earnings.set(driverId, { companyIncentive, estimatedCommission });
  }
  return earnings;
};

/** Records what the driver who accepted was promised, so they get what they saw. */
export const promiseRideIncentive = async (ride, driverId) => {
  const amounts = await estimateRideIncentives(ride, [driverId]);
  const promised = amounts.get(String(driverId)) || 0;
  await Ride.updateOne({ _id: ride._id }, { $set: { promisedIncentive: promised } });
  return promised;
};

/**
 * Decides and, if earned, pays the top-up for one completed ride. Safe to call
 * any number of times. Returns the amount paid by this call, or 0.
 */
export const payRideIncentive = async (rideId) => {
  const settings = await getSettings();
  const ride = await Ride.findById(rideId)
    .select('status driverId fare vehicleTypeId serviceType estimatedDistanceMeters completedAt walletSettledAt promisedIncentive')
    .lean();
  const promised = Number(ride?.promisedIncentive || 0);
  if (!settings.enabled && promised <= 0) return 0;

  await ensureIndexes();
  if (await RideIncentivePayout.exists({ rideId })) return 0;

  if (!ride?.driverId || ride.status !== 'completed' || !ride.completedAt) return 0;
  // A ride from before it was switched on never earns, however it got here,
  // unless the driver accepted it on a promise.
  if (promised <= 0 && (!settings.startsAt || new Date(ride.completedAt) < new Date(settings.startsAt))) return 0;

  const driver = await Driver.findById(ride.driverId).select('phone approve status deletedAt').lean();
  const day = toIstDayKey(ride.completedAt);
  const paidToday = await RideIncentivePayout.countDocuments({
    driverId: ride.driverId,
    day,
    status: { $in: ['pending', 'paid'] },
  });
  const decision = promised > 0
    ? { pay: true, amount: promised, reason: '' }
    : decideIncentive({
      settings: normalizeIncentiveSettings(settings),
      ride,
      driver,
      paidToday,
    });

  let row;
  try {
    row = await RideIncentivePayout.create({
      rideId,
      driverId: ride.driverId,
      vehicleTypeId: String(ride.vehicleTypeId || ''),
      day,
      fare: ride.fare || 0,
      distanceMeters: Math.round(ride.estimatedDistanceMeters || 0),
      amount: decision.amount,
      status: decision.pay ? 'pending' : 'skipped',
      reason: decision.reason,
    });
  } catch (error) {
    if (error?.code === 11000) return 0; // someone else got to this ride first
    throw error;
  }
  if (!decision.pay) return 0;

  let walletResult;
  try {
    walletResult = await applyDriverWalletAdjustment({
      driverId: ride.driverId,
      rideId,
      amount: decision.amount,
      type: 'adjustment',
      description: 'Company incentive for ride',
      metadata: { source: 'ride_incentive', payoutId: String(row._id), fare: ride.fare || 0 },
    });
  } catch (error) {
    await RideIncentivePayout.updateOne(
      { _id: row._id },
      { $set: { status: 'failed', error: String(error?.message || error).slice(0, 300) } },
    );
    throw error;
  }

  await Promise.all([
    RideIncentivePayout.updateOne(
      { _id: row._id },
      { $set: { status: 'paid', paidAt: new Date(), walletTransactionId: walletResult?.transaction?._id || null } },
    ),
    Ride.updateOne({ _id: rideId }, { $set: { companyIncentive: decision.amount } }),
  ]);

  sendPushNotificationToEntities({
    driverIds: [ride.driverId],
    title: `₹${decision.amount} incentive added to your wallet`,
    body: 'Paid by OHO for your completed ride.',
    data: { type: 'driver_ride_incentive', rideId: String(rideId) },
  }).catch((error) => console.error('[ride-incentive] push failed', String(ride.driverId), error));

  return decision.amount;
};

export const runIncentiveSweep = async (now = new Date()) => {
  await ensureIndexes();
  const settings = await getSettings();
  const isOn = Boolean(settings.enabled && settings.startsAt);

  // With it off, only rides a driver accepted on a promise are still owed.
  const lookback = new Date(now.getTime() - SWEEP_LOOKBACK_MS);
  const rides = await Ride.find({
    status: 'completed',
    driverId: { $ne: null },
    walletSettledAt: { $ne: null },
    completedAt: { $gte: isOn ? new Date(Math.max(new Date(settings.startsAt).getTime(), lookback.getTime())) : lookback },
    ...(isOn ? {} : { promisedIncentive: { $gt: 0 } }),
  }).select('_id').limit(1000).lean();
  if (rides.length === 0) return 0;

  const done = new Set(
    (await RideIncentivePayout.find({ rideId: { $in: rides.map((ride) => ride._id) } }).select('rideId').lean())
      .map((row) => String(row.rideId)),
  );

  let paid = 0;
  for (const ride of rides) {
    if (done.has(String(ride._id))) continue;
    try {
      if (await payRideIncentive(ride._id)) paid += 1;
    } catch (error) {
      // Already marked failed. One ride mustn't stop the rest.
      console.error('[ride-incentive] could not pay ride', String(ride._id), error);
    }
  }
  return paid;
};

export const startIncentiveLoop = () => {
  if (sweepTimer) return;
  const run = () => {
    runIncentiveSweep().catch((error) => console.error('[ride-incentive] sweep failed', error));
  };
  run();
  sweepTimer = setInterval(run, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
};

export const listIncentivePayouts = async ({ limit = 30 } = {}, now = new Date()) => {
  const today = toIstDayKey(now);
  const size = Math.min(200, Math.max(1, Number(limit) || 30));

  const [rows, totals, attention, vehicles] = await Promise.all([
    RideIncentivePayout.find().sort({ createdAt: -1 }).limit(size).populate('driverId', 'name phone').lean(),
    RideIncentivePayout.aggregate([
      { $match: { status: 'paid', day: { $gte: `${monthOf(today)}-01` } } },
      {
        $group: {
          _id: null,
          monthCount: { $sum: 1 },
          monthAmount: { $sum: '$amount' },
          todayCount: { $sum: { $cond: [{ $eq: ['$day', today] }, 1, 0] } },
          todayAmount: { $sum: { $cond: [{ $eq: ['$day', today] }, '$amount', 0] } },
        },
      },
    ]),
    RideIncentivePayout.countDocuments({
      $or: [
        { status: 'failed' },
        { status: 'pending', createdAt: { $lt: new Date(now.getTime() - 10 * 60 * 1000) } },
      ],
    }),
    Vehicle.find().select('name').lean(),
  ]);

  const names = new Map(vehicles.map((item) => [String(item._id), item.name]));
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
      vehicle: names.get(row.vehicleTypeId) || '',
      fare: row.fare,
      distanceKm: Math.round((row.distanceMeters || 0) / 100) / 10,
      amount: row.amount,
      status: row.status,
      reason: row.reason || row.error,
      day: row.day,
      createdAt: row.createdAt,
    })),
  };
};
