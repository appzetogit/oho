import { Router } from 'express';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { asyncHandler } from '../../../../utils/asyncHandler.js';
import {
  adjustRiderCoins,
  getCoinSettings,
  getCoinSummary,
  getRiderCoins,
  listRiderCoinAccounts,
  listRiderCoinTransactions,
  startCoinSweeper,
  updateCoinSettings,
} from '../services/coinService.js';

/**
 * Rider coins: earned on completed rides, run from the admin panel.
 *
 * Mounted ahead of the admin and user routers so no catch-all in either can
 * swallow these paths, and each route checks its own login rather than relying
 * on the order other routers happen to be mounted in.
 */
export const coinsRouter = Router();

const admin = authenticate(['admin']);
const rider = authenticate(['user']);

coinsRouter.get('/admin/coins/settings', admin, asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await getCoinSettings() });
}));

coinsRouter.put('/admin/coins/settings', admin, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await updateCoinSettings(req.body || {}, req.auth?.sub) });
}));

coinsRouter.get('/admin/coins/summary', admin, asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await getCoinSummary() });
}));

coinsRouter.get('/admin/coins/riders', admin, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await listRiderCoinAccounts(req.query || {}) });
}));

coinsRouter.get('/admin/coins/riders/:userId/transactions', admin, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await listRiderCoinTransactions(req.params.userId, req.query || {}) });
}));

coinsRouter.post('/admin/coins/riders/:userId/adjust', admin, asyncHandler(async (req, res) => {
  const result = await adjustRiderCoins({
    userId: req.params.userId,
    coins: req.body?.coins,
    note: req.body?.note,
    adminId: req.auth?.sub,
  });
  res.status(201).json({ success: true, data: { balance: result.account.balance, transaction: result.transaction } });
}));

// What the rider app shows: balance, the earning rules, and recent history.
coinsRouter.get('/users/coins', rider, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await getRiderCoins(req.auth.sub, req.query || {}) });
}));

// Start awarding coins for completed rides. Every API worker runs it; the
// unique index on each ride's award keeps a ride from being paid twice.
startCoinSweeper();
