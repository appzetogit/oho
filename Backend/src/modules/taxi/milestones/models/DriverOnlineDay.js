import mongoose from 'mongoose';

/**
 * How long a driver was really online on one India day.
 *
 * Separate from incentiveTracking.dailyActivity on purpose. That one counts
 * from pressing "go online" to going offline, even if the app was closed in
 * between. Money depends on this one, so it only grows while the app is
 * actually talking to the server (see onlineTimeService).
 */
const driverOnlineDaySchema = new mongoose.Schema(
  {
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiDriver', required: true },
    day: { type: String, required: true }, // 'YYYY-MM-DD', India time
    seconds: { type: Number, default: 0 },
  },
  { timestamps: true },
);

driverOnlineDaySchema.index({ driverId: 1, day: 1 }, { unique: true });
driverOnlineDaySchema.index({ day: 1 });

export const DriverOnlineDay = mongoose.model('TaxiDriverOnlineDay', driverOnlineDaySchema);
