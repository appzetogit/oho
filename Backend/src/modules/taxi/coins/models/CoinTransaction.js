import mongoose from 'mongoose';

/**
 * One line in a rider's coin history: what changed, by how much, and why.
 *
 * The partial unique index on (rideId) for ride earnings is what guarantees a
 * ride pays out once. Both API workers run the award sweep, and they may pick
 * up the same ride at the same moment; the second insert fails on this index
 * and that worker simply moves on.
 */
const coinTransactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiUser',
      required: true,
    },
    type: {
      type: String,
      enum: ['ride_earn', 'admin_credit', 'admin_debit'],
      required: true,
    },
    // Signed: positive adds coins, negative removes them.
    coins: { type: Number, required: true },
    balanceAfter: { type: Number, default: null },
    rideId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiRide',
      default: null,
    },
    fare: { type: Number, default: null },
    note: { type: String, default: '', trim: true, maxlength: 300 },
    // Admin who made a manual change; empty for automatic earnings.
    createdBy: { type: String, default: '' },
  },
  { timestamps: true },
);

coinTransactionSchema.index({ userId: 1, createdAt: -1 });
coinTransactionSchema.index(
  { rideId: 1 },
  { unique: true, partialFilterExpression: { type: 'ride_earn' } },
);

export const CoinTransaction =
  mongoose.models.TaxiCoinTransaction || mongoose.model('TaxiCoinTransaction', coinTransactionSchema);
