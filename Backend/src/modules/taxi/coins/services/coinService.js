import mongoose from 'mongoose';
import { ApiError } from '../../../../utils/ApiError.js';
import { CoinSettings } from '../models/CoinSettings.js';
import { RiderCoinAccount } from '../models/RiderCoinAccount.js';
import { CoinTransaction } from '../models/CoinTransaction.js';
import { Ride } from '../../user/models/Ride.js';
import { User } from '../../user/models/User.js';

const toWholeCoins = (value) => Math.max(0, Math.floor(Number(value) || 0));

// ---------------------------------------------------------------- settings

export const getCoinSettings = async () => {
  const settings = await CoinSettings.findOne({ key: 'rider_coins' }).lean();
  if (settings) return settings;
  // First read creates the document with the defaults, switched off.
  return (await CoinSettings.findOneAndUpdate(
    { key: 'rider_coins' },
    { $setOnInsert: { key: 'rider_coins' } },
    { upsert: true, returnDocument: 'after', lean: true },
  ));
};

const SETTING_FIELDS = ['coinsPerRide', 'coinsPerHundredRupees', 'minFareForCoins', 'maxCoinsPerRide'];

export const updateCoinSettings = async (payload = {}, adminId = '') => {
  const current = await getCoinSettings();
  const update = { updatedBy: String(adminId || '') };

  for (const field of SETTING_FIELDS) {
    if (payload[field] === undefined) continue;
    const value = Number(payload[field]);
    if (!Number.isFinite(value) || value < 0) {
      throw new ApiError(400, `${field} must be zero or a positive number`);
    }
    update[field] = field === 'minFareForCoins' ? value : Math.floor(value);
  }

  if (payload.enabled !== undefined) {
    update.enabled = payload.enabled === true || payload.enabled === 'true' || payload.enabled === 1 || payload.enabled === '1';
    // Rides completed before coins were first switched on never earn.
    if (update.enabled && !current.startsAt) update.startsAt = new Date();
  }

  return CoinSettings.findOneAndUpdate({ key: 'rider_coins' }, { $set: update }, { returnDocument: 'after', lean: true });
};

/** How many coins a ride with this fare earns under these rules. */
export const coinsForFare = (fare, settings) => {
  const amount = Number(fare) || 0;
  if (amount <= 0) return 0;
  if (Number(settings.minFareForCoins || 0) > 0 && amount < Number(settings.minFareForCoins)) return 0;

  let coins = toWholeCoins(settings.coinsPerRide) + toWholeCoins((amount / 100) * Number(settings.coinsPerHundredRupees || 0));
  const cap = toWholeCoins(settings.maxCoinsPerRide);
  if (cap > 0) coins = Math.min(coins, cap);
  return coins;
};

// ---------------------------------------------------------------- balances

const addToBalance = async (userId, coins, extra = {}) => {
  const account = await RiderCoinAccount.findOneAndUpdate(
    { userId },
    { $inc: { balance: coins, ...extra.inc }, ...(extra.set ? { $set: extra.set } : {}) },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  return account;
};

/**
 * Award the coins for one completed ride, at most once.
 *
 * The ledger row is written first: its unique index on rideId is the lock that
 * stops two workers paying the same ride. Only then does the balance move. If
 * moving the balance fails, the ledger row is removed so the next sweep tries
 * again rather than leaving a payout recorded but never paid.
 */
export const awardCoinsForRide = async (ride, settings) => {
  const coins = coinsForFare(ride.fare, settings);
  if (!coins || !ride.userId) return { awarded: 0, reason: 'nothing to award' };

  let entry;
  try {
    entry = await CoinTransaction.create({
      userId: ride.userId,
      type: 'ride_earn',
      coins,
      rideId: ride._id,
      fare: Number(ride.fare) || 0,
      note: 'Earned for a completed ride',
    });
  } catch (error) {
    if (error?.code === 11000) return { awarded: 0, reason: 'already awarded' };
    throw error;
  }

  try {
    const account = await addToBalance(ride.userId, coins, {
      inc: { totalEarned: coins },
      set: { lastEarnedAt: new Date() },
    });
    await CoinTransaction.updateOne({ _id: entry._id }, { $set: { balanceAfter: account.balance } });
    return { awarded: coins, balance: account.balance };
  } catch (error) {
    await CoinTransaction.deleteOne({ _id: entry._id }).catch(() => null);
    throw error;
  }
};

/**
 * Add or remove coins by hand, from the admin panel. A reason is required so
 * every manual change can be explained later. A debit can never take a
 * balance below zero.
 */
export const adjustRiderCoins = async ({ userId, coins, note, adminId }) => {
  if (!mongoose.isValidObjectId(userId)) throw new ApiError(400, 'Invalid rider');
  const amount = Math.trunc(Number(coins));
  if (!Number.isFinite(amount) || amount === 0) throw new ApiError(400, 'Enter a whole number of coins, positive to add or negative to remove');
  const reason = String(note || '').trim();
  if (!reason) throw new ApiError(400, 'A reason is required');

  const user = await User.findById(userId).select('_id').lean();
  if (!user) throw new ApiError(404, 'Rider not found');

  let account;
  if (amount > 0) {
    account = await addToBalance(userId, amount, { inc: { totalAdjusted: amount } });
  } else {
    // Only succeeds when the balance covers the debit, in one atomic step.
    account = await RiderCoinAccount.findOneAndUpdate(
      { userId, balance: { $gte: -amount } },
      { $inc: { balance: amount, totalAdjusted: amount } },
      { returnDocument: 'after' },
    );
    if (!account) throw new ApiError(400, 'The rider does not have that many coins to remove');
  }

  const entry = await CoinTransaction.create({
    userId,
    type: amount > 0 ? 'admin_credit' : 'admin_debit',
    coins: amount,
    balanceAfter: account.balance,
    note: reason,
    createdBy: String(adminId || ''),
  });

  return { account, transaction: entry };
};

// ---------------------------------------------------------------- reading

export const getRiderCoins = async (userId, { limit = 20 } = {}) => {
  const [settings, account, transactions] = await Promise.all([
    getCoinSettings(),
    RiderCoinAccount.findOne({ userId }).lean(),
    CoinTransaction.find({ userId }).sort({ createdAt: -1 }).limit(Math.min(Number(limit) || 20, 100)).lean(),
  ]);

  return {
    enabled: Boolean(settings.enabled),
    balance: account?.balance || 0,
    totalEarned: account?.totalEarned || 0,
    rules: {
      coinsPerRide: settings.coinsPerRide,
      coinsPerHundredRupees: settings.coinsPerHundredRupees,
      minFareForCoins: settings.minFareForCoins,
      maxCoinsPerRide: settings.maxCoinsPerRide,
    },
    transactions: transactions.map((t) => ({
      id: String(t._id),
      type: t.type,
      coins: t.coins,
      balanceAfter: t.balanceAfter,
      note: t.note,
      rideId: t.rideId ? String(t.rideId) : null,
      createdAt: t.createdAt,
    })),
  };
};

export const listRiderCoinAccounts = async ({ page = 1, limit = 20, search = '' } = {}) => {
  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = Math.min(Math.max(1, Number(limit) || 20), 100);
  const filter = {};

  const term = String(search || '').trim();
  if (term) {
    // A search covers every rider, not only those who already hold coins, so
    // staff can find someone with a zero balance and give them coins.
    const pattern = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const userFilter = { deletedAt: null, $or: [{ name: pattern }, { phone: pattern }] };
    const [users, total] = await Promise.all([
      User.find(userFilter).select('name phone').sort({ name: 1 }).skip((pageNum - 1) * pageSize).limit(pageSize).lean(),
      User.countDocuments(userFilter),
    ]);
    const accounts = await RiderCoinAccount.find({ userId: { $in: users.map((u) => u._id) } }).lean();
    const byUser = new Map(accounts.map((a) => [String(a.userId), a]));

    return {
      results: users.map((u) => {
        const a = byUser.get(String(u._id));
        return {
          userId: String(u._id),
          name: u.name || 'Unknown rider',
          phone: u.phone || '',
          balance: a?.balance || 0,
          totalEarned: a?.totalEarned || 0,
          totalAdjusted: a?.totalAdjusted || 0,
          lastEarnedAt: a?.lastEarnedAt || null,
        };
      }),
      paginator: { current_page: pageNum, per_page: pageSize, total, last_page: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  const [rows, total] = await Promise.all([
    RiderCoinAccount.find(filter).sort({ balance: -1, updatedAt: -1 }).skip((pageNum - 1) * pageSize).limit(pageSize)
      .populate('userId', 'name phone').lean(),
    RiderCoinAccount.countDocuments(filter),
  ]);

  return {
    results: rows.map((r) => ({
      userId: r.userId?._id ? String(r.userId._id) : String(r.userId),
      name: r.userId?.name || 'Unknown rider',
      phone: r.userId?.phone || '',
      balance: r.balance,
      totalEarned: r.totalEarned,
      totalAdjusted: r.totalAdjusted,
      lastEarnedAt: r.lastEarnedAt,
    })),
    paginator: { current_page: pageNum, per_page: pageSize, total, last_page: Math.max(1, Math.ceil(total / pageSize)) },
  };
};

export const listRiderCoinTransactions = async (userId, { limit = 50 } = {}) => {
  if (!mongoose.isValidObjectId(userId)) throw new ApiError(400, 'Invalid rider');
  const [user, account, rows] = await Promise.all([
    User.findById(userId).select('name phone').lean(),
    RiderCoinAccount.findOne({ userId }).lean(),
    CoinTransaction.find({ userId }).sort({ createdAt: -1 }).limit(Math.min(Number(limit) || 50, 200)).lean(),
  ]);
  if (!user) throw new ApiError(404, 'Rider not found');

  return {
    rider: { userId: String(user._id), name: user.name || '', phone: user.phone || '' },
    balance: account?.balance || 0,
    totalEarned: account?.totalEarned || 0,
    transactions: rows.map((t) => ({
      id: String(t._id),
      type: t.type,
      coins: t.coins,
      balanceAfter: t.balanceAfter,
      fare: t.fare,
      note: t.note,
      rideId: t.rideId ? String(t.rideId) : null,
      createdBy: t.createdBy,
      createdAt: t.createdAt,
    })),
  };
};

export const getCoinSummary = async () => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [settings, totals, ridersWithCoins, last24h] = await Promise.all([
    getCoinSettings(),
    RiderCoinAccount.aggregate([{ $group: { _id: null, balance: { $sum: '$balance' }, earned: { $sum: '$totalEarned' } } }]),
    RiderCoinAccount.countDocuments({ balance: { $gt: 0 } }),
    CoinTransaction.aggregate([
      { $match: { type: 'ride_earn', createdAt: { $gte: since } } },
      { $group: { _id: null, coins: { $sum: '$coins' }, rides: { $sum: 1 } } },
    ]),
  ]);

  return {
    enabled: Boolean(settings.enabled),
    startsAt: settings.startsAt,
    coinsInCirculation: totals[0]?.balance || 0,
    coinsEverEarned: totals[0]?.earned || 0,
    ridersWithCoins,
    earnedLast24h: last24h[0]?.coins || 0,
    ridesRewardedLast24h: last24h[0]?.rides || 0,
  };
};

// ---------------------------------------------------------------- awarding

const SWEEP_INTERVAL_MS = 60 * 1000;
const SWEEP_BATCH = 200;
let sweepTimer = null;
let sweeping = false;

/**
 * Award coins for rides completed since the last sweep.
 *
 * Awarding runs here, on a timer, instead of inside the ride-completion code,
 * so the coins feature never touches the path that finishes a trip: if it ever
 * failed, rides would still complete normally and the next sweep would catch
 * up. Rides already awarded are marked so they are not looked at again.
 */
export const sweepCompletedRides = async () => {
  if (sweeping) return { skipped: true };
  sweeping = true;
  try {
    const settings = await getCoinSettings();
    if (!settings.enabled || !settings.startsAt) return { enabled: false };

    const rides = await Ride.collection
      .find({
        status: 'completed',
        completedAt: { $gte: new Date(settings.startsAt) },
        userId: { $ne: null },
        coinsAwardedAt: null,
      })
      .project({ _id: 1, userId: 1, fare: 1 })
      .limit(SWEEP_BATCH)
      .toArray();

    let awarded = 0;
    for (const ride of rides) {
      try {
        const result = await awardCoinsForRide(ride, settings);
        awarded += result.awarded || 0;
        await Ride.collection.updateOne({ _id: ride._id }, { $set: { coinsAwardedAt: new Date() } });
      } catch (error) {
        console.warn('[coins] could not award ride', String(ride._id), error.message);
      }
    }
    return { checked: rides.length, awarded };
  } finally {
    sweeping = false;
  }
};

export const startCoinSweeper = () => {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    sweepCompletedRides().catch((error) => console.warn('[coins] sweep failed:', error.message));
  }, SWEEP_INTERVAL_MS);
  // Do not keep the process alive just for this timer during shutdown.
  sweepTimer.unref?.();
};
