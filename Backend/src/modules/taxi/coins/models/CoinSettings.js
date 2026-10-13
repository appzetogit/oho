import mongoose from 'mongoose';

/**
 * The rules for rider coins. A single document, edited from the admin panel.
 *
 * Coins are off until an admin switches them on. `startsAt` is stamped the
 * first time they are switched on, and only rides completed after it earn —
 * otherwise enabling the feature would pay out for every ride ever taken.
 */
const coinSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'rider_coins', unique: true },
    enabled: { type: Boolean, default: false },
    // Flat coins for every completed ride.
    coinsPerRide: { type: Number, default: 10, min: 0 },
    // Extra coins per ₹100 of fare, so longer rides earn more. 0 turns it off.
    coinsPerHundredRupees: { type: Number, default: 0, min: 0 },
    // Rides below this fare earn nothing. 0 means every ride qualifies.
    minFareForCoins: { type: Number, default: 0, min: 0 },
    // Ceiling on coins from one ride. 0 means no ceiling.
    maxCoinsPerRide: { type: Number, default: 0, min: 0 },
    startsAt: { type: Date, default: null },
    updatedBy: { type: String, default: '' },
  },
  { timestamps: true },
);

export const CoinSettings =
  mongoose.models.TaxiCoinSettings || mongoose.model('TaxiCoinSettings', coinSettingsSchema);
