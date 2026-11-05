import mongoose from 'mongoose';

/**
 * The company's per-ride top-up for drivers. A single document, edited from the
 * admin panel, and off until an admin switches it on.
 *
 * `startsAt` is stamped every time it's switched on, and only rides completed
 * after it earn, so turning it on never pays for rides from before.
 */
const rideIncentiveSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'ride_incentive', unique: true },
    enabled: { type: Boolean, default: false },
    rates: {
      type: [
        new mongoose.Schema(
          {
            vehicleTypeId: { type: String, required: true },
            amount_per_ride: { type: Number, default: 0, min: 0 },
            amount_per_km: { type: Number, default: 0, min: 0 },
            max_per_ride: { type: Number, default: 0, min: 0 },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    max_rides_per_driver_per_day: { type: Number, default: 10, min: 0 },
    min_distance_km: { type: Number, default: 1, min: 0 },
    only_driver_phones: { type: [String], default: [] },
    startsAt: { type: Date, default: null },
    updatedBy: { type: String, default: '' },
  },
  { timestamps: true },
);

export const RideIncentiveSettings = mongoose.models.TaxiRideIncentiveSettings
  || mongoose.model('TaxiRideIncentiveSettings', rideIncentiveSettingsSchema);
