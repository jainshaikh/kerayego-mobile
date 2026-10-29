import type { Market } from '../../types/enums';
import { titleCase } from '../../utils/format';

// The fields of TripCard/TripDetail/TripInquiryTrip this reads — all fit (a
// trip-inquiry response's userVehicle carries no id).
interface TripVehicleSource {
  isReturnTrip?: boolean;
  userVehicle: {
    id?: string;
    make: string;
    model: string;
    year: number | null;
    color: string | null;
    plateNumber?: string;
    country?: Market;
    images: { id?: string; url: string; altText: string | null }[];
  } | null;
  fleetVehicle?: {
    id: string;
    title: string;
    make: string;
    model: string;
    year: number;
    images: { id?: string; url: string; altText: string | null }[];
  } | null;
}

export interface TripVehicle {
  // undefined only for an own car read from a trip-inquiry response.
  id: string | undefined;
  // A rental business's fleet car (return trip) rather than the poster's own.
  isFleet: boolean;
  // e.g. "Toyota Corolla"; a fleet car's listing title (which carries its year).
  name: string;
  year: number | null;
  // Own car only — a fleet listing has no colour or plate on a trip.
  color: string | null;
  plateNumber: string | null;
  country: Market | undefined;
  images: { id?: string; url: string; altText: string | null }[];
}

/**
 * The car a trip runs in: on a return trip the business's fleetVehicle
 * (userVehicle is null), otherwise the poster's own userVehicle. null when
 * the backend sent neither.
 */
export function tripVehicle(trip: TripVehicleSource): TripVehicle | null {
  if (trip.isReturnTrip) {
    const fleet = trip.fleetVehicle;
    if (!fleet) return null;
    return {
      id: fleet.id,
      isFleet: true,
      name: fleet.title || `${titleCase(fleet.make)} ${titleCase(fleet.model)}`,
      year: fleet.year,
      color: null,
      plateNumber: null,
      country: undefined,
      images: fleet.images,
    };
  }
  const own = trip.userVehicle;
  if (!own) return null;
  return {
    id: own.id,
    isFleet: false,
    name: `${titleCase(own.make)} ${titleCase(own.model)}`,
    year: own.year,
    color: own.color,
    plateNumber: own.plateNumber ?? null,
    country: own.country,
    images: own.images,
  };
}
