import { Router } from 'express';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { listMilestonePayouts } from '../services/milestoneService.js';

/**
 * Admin view of driver milestone payments. The milestones themselves are
 * configured with the driver referral settings.
 *
 * Mounted ahead of the admin router, like coins and payouts, so no catch-all
 * there can swallow the path, and it checks the admin login itself.
 */
export const milestonesRouter = Router();

milestonesRouter.get(
  '/admin/driver-milestones/payouts',
  authenticate(['admin']),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await listMilestonePayouts(req.query || {}) });
  }),
);
