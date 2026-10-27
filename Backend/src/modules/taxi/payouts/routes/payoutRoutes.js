import { Router } from 'express';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { getWithdrawalPayoutRows } from '../services/payoutExportService.js';

/**
 * Driver payouts. For now this only feeds the "Export for bank" spreadsheet on
 * the withdrawals screen; automated HDFC payouts will live here too.
 *
 * Mounted ahead of the admin router, like coins, so no catch-all there can
 * swallow the path, and it checks the admin login itself.
 */
export const payoutsRouter = Router();

payoutsRouter.get(
  '/admin/payouts/withdrawals/export',
  authenticate(['admin']),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await getWithdrawalPayoutRows(req.query || {}) });
  }),
);
