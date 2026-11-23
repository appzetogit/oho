import CarIcon from '@/assets/icons/car.png';
import BikeIcon from '@/assets/icons/bike.png';
import AutoIcon from '@/assets/icons/auto.png';

/** Bundled marker for a vehicle kind ("bike", "auto", "car", "premium", a type name…). */
export const getMapIconForKind = (value = '') => {
  const kind = String(value || '').trim().toLowerCase();
  if (kind.includes('bike') || kind.includes('scooter') || kind.includes('moto')) return BikeIcon;
  if (kind.includes('auto') || kind.includes('rickshaw')) return AutoIcon;
  return CarIcon;
};

/** Vehicle types from the admin panel, keyed by id. */
export const buildVehicleTypeIndex = (vehicleTypes = []) =>
  new Map((Array.isArray(vehicleTypes) ? vehicleTypes : []).map((type) => [String(type?._id || type?.id || ''), type]));

/**
 * The map marker for a driver.
 *
 * Decided by the driver's vehicle type as configured in the admin panel, then
 * the driver's vehicle type name. The stored icon field comes last: older
 * accounts have it set to "car" whatever they drive, which drew bikes and
 * autos as cars.
 */
export const getDriverMapIcon = (driver = {}, vehicleTypeIndex = new Map()) => {
  const typeId = String(driver?.vehicle_type_id?._id || driver?.vehicle_type_id || '');
  const type = typeId ? vehicleTypeIndex.get(typeId) : null;
  const kind = type?.icon_types || type?.name || driver?.vehicle_type || driver?.vehicle_icon_type || '';
  return getMapIconForKind(kind);
};

/** A driver's position, or null when it is missing or the [0, 0] placeholder. */
export const getDriverPosition = (driver = {}) => {
  const lat = Number(driver?.latitude);
  const lng = Number(driver?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
};
