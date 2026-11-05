import { Router } from 'express';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { asyncHandler } from '../../../../utils/asyncHandler.js';
import {
  getIncentiveAdminView,
  listIncentivePayouts,
  updateIncentiveSettings,
} from '../services/incentiveService.js';

/**
 * Admin controls for the company's per-ride top-up for drivers.
 *
 * Mounted ahead of the admin router, like coins and payouts, so no catch-all
 * there can swallow the path, and it checks the admin login itself.
 */
export const rideIncentivesRouter = Router();

const admin = authenticate(['admin']);

rideIncentivesRouter.get('/admin/ride-incentives/settings', admin, asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await getIncentiveAdminView() });
}));

rideIncentivesRouter.put('/admin/ride-incentives/settings', admin, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await updateIncentiveSettings(req.body || {}, req.auth?.sub) });
}));

rideIncentivesRouter.get('/admin/ride-incentives/payouts', admin, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await listIncentivePayouts(req.query || {}) });
}));
