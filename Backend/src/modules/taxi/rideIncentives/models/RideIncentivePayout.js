import mongoose from 'mongoose';

/**
 * The decision for one completed ride, paid or not.
 *
 * The unique index on rideId is what guarantees a ride pays once: the row goes
 * in before any money moves, so a second attempt fails on the insert. Rides
 * that don't qualify get a row too, which makes the decision final (raising a
 * limit later doesn't back-pay) and lets an admin see why.
 *
 * status:
 *   pending  row written, wallet not confirmed yet
 *   paid     money is in the wallet
 *   skipped  didn't qualify; `reason` says why
 *   failed   the wallet credit threw. Never retried by itself, because the money
 *            may have landed before the error; an admin checks the wallet
 */
const rideIncentivePayoutSchema = new mongoose.Schema(
  {
    rideId: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiRide', required: true },
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiDriver', required: true },
    vehicleTypeId: { type: String, default: '' },
    day: { type: String, required: true }, // India date the ride was completed
    fare: { type: Number, default: 0 },
    distanceMeters: { type: Number, default: 0 },
    amount: { type: Number, default: 0 },
    status: { type: String, enum: ['pending', 'paid', 'skipped', 'failed'], required: true },
    reason: { type: String, default: '' },
    walletTransactionId: { type: mongoose.Schema.Types.ObjectId, default: null },
    paidAt: { type: Date, default: null },
    error: { type: String, default: '' },
  },
  { timestamps: true },
);

rideIncentivePayoutSchema.index({ rideId: 1 }, { unique: true });
rideIncentivePayoutSchema.index({ driverId: 1, day: 1, status: 1 });
rideIncentivePayoutSchema.index({ createdAt: -1 });

export const RideIncentivePayout = mongoose.models.TaxiRideIncentivePayout
  || mongoose.model('TaxiRideIncentivePayout', rideIncentivePayoutSchema);
