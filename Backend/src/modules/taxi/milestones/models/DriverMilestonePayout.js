import mongoose from 'mongoose';

/**
 * One milestone payment to one driver.
 *
 * The unique index is what guarantees a period pays once. Both API workers run
 * the payout sweep and may reach the same driver together; the row is inserted
 * before any money moves, so the second insert fails and that worker moves on.
 *
 * status:
 *   pending  row written, wallet not confirmed yet
 *   paid     money is in the wallet
 *   failed   the wallet credit threw. Never retried by itself, because the
 *            money may have landed before the error; an admin checks the wallet
 */
const driverMilestonePayoutSchema = new mongoose.Schema(
  {
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiDriver', required: true },
    milestoneId: { type: String, required: true },
    periodKey: { type: String, required: true },
    windowStart: { type: String, required: true },
    windowEnd: { type: String, required: true },
    amount: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' },
    paidVia: { type: String, enum: ['auto', 'claim'], required: true },
    // What was required when it paid, since the settings can change later.
    milestoneName: { type: String, default: '' },
    requiredHours: { type: Number, default: 0 },
    requiredDays: { type: Number, default: 1 },
    requiredTrips: { type: Number, default: 0 },
    onlineSeconds: { type: Number, default: 0 },
    trips: { type: Number, default: 0 },
    walletTransactionId: { type: mongoose.Schema.Types.ObjectId, default: null },
    paidAt: { type: Date, default: null },
    error: { type: String, default: '' },
  },
  { timestamps: true },
);

driverMilestonePayoutSchema.index({ driverId: 1, milestoneId: 1, periodKey: 1 }, { unique: true });
driverMilestonePayoutSchema.index({ createdAt: -1 });
driverMilestonePayoutSchema.index({ status: 1 });

export const DriverMilestonePayout = mongoose.model('TaxiDriverMilestonePayout', driverMilestonePayoutSchema);
