import { ApiError } from '../../../../utils/ApiError.js';
import { Vehicle } from '../../admin/models/Vehicle.js';
import { Driver } from '../../driver/models/Driver.js';
import { applyDriverWalletAdjustment } from '../../driver/services/walletService.js';
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
 * Decides and, if earned, pays the top-up for one completed ride. Safe to call
 * any number of times. Returns the amount paid by this call, or 0.
 */
export const payRideIncentive = async (rideId) => {
  const settings = await getSettings();
  if (!settings.enabled) return 0;

  await ensureIndexes();
  if (await RideIncentivePayout.exists({ rideId })) return 0;

  const ride = await Ride.findById(rideId)
    .select('status driverId fare vehicleTypeId serviceType estimatedDistanceMeters completedAt walletSettledAt')
    .lean();
  if (!ride?.driverId || ride.status !== 'completed' || !ride.completedAt) return 0;
  // A ride from before it was switched on never earns, however it got here.
  if (!settings.startsAt || new Date(ride.completedAt) < new Date(settings.startsAt)) return 0;

  const driver = await Driver.findById(ride.driverId).select('phone approve status deletedAt').lean();
  const day = toIstDayKey(ride.completedAt);
  const paidToday = await RideIncentivePayout.countDocuments({
    driverId: ride.driverId,
    day,
    status: { $in: ['pending', 'paid'] },
  });
  const decision = decideIncentive({
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
  if (!settings.enabled || !settings.startsAt) return 0;

  const since = new Date(Math.max(new Date(settings.startsAt).getTime(), now.getTime() - SWEEP_LOOKBACK_MS));
  const rides = await Ride.find({
    status: 'completed',
    completedAt: { $gte: since },
    driverId: { $ne: null },
    walletSettledAt: { $ne: null },
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
