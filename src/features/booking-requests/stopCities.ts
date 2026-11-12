import type { BookingStopPayload } from '../../api/booking-requests.api';
import { geoApi } from '../../api/geo.api';
import { endStopIndexes, withCities } from './rentalRequest';

/**
 * The stops with the city of the first pickup and the last drop-off filled
 * in (GET /geo/reverse) — the backend copies those two into the request's
 * pickupCity / dropoffCity, which the return-trip rule (A48) reads. Picking a
 * place gives coordinates but no city, so it's looked up once, on send.
 * Best-effort: a failed lookup sends that stop without a city.
 */
export async function withEndStopCities(stops: BookingStopPayload[]): Promise<BookingStopPayload[]> {
  const indexes = endStopIndexes(stops);
  const results = await Promise.allSettled(indexes.map((i) => geoApi.reverseGeocode(stops[i].lat, stops[i].lng)));
  const cities = new Map<number, string | null>();
  results.forEach((result, n) => {
    if (result.status === 'fulfilled') cities.set(indexes[n], result.value.city);
  });
  return withCities(stops, cities);
}
