import mongoose from 'mongoose';

/**
 * A rider's coin balance. Kept in its own collection rather than on the user
 * record, so the coins feature can never interfere with user data.
 *
 * The balance only ever moves through $inc in coinService, alongside a
 * CoinTransaction row that explains the change.
 */
const riderCoinAccountSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiUser',
      required: true,
      unique: true,
    },
    balance: { type: Number, default: 0, min: 0 },
    // Everything ever earned from rides.
    totalEarned: { type: Number, default: 0 },
    // Net of everything an admin added or removed by hand.
    totalAdjusted: { type: Number, default: 0 },
    lastEarnedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

riderCoinAccountSchema.index({ balance: -1 });

export const RiderCoinAccount =
  mongoose.models.TaxiRiderCoinAccount || mongoose.model('TaxiRiderCoinAccount', riderCoinAccountSchema);
