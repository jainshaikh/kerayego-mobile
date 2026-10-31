import type { PlateHistory } from '../../types/api.types';

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * "N rides on KerayeGo" for a car's rating line (GET /reviews/summary's
 * rideCount — the plate's completed rentals + carpool trips, any owner), or
 * null when there's nothing to show. Car subjects only; never USER.
 */
export function rideCountLabel(rideCount: number | undefined): string | null {
  if (!rideCount || rideCount <= 0) return null;
  return `${plural(rideCount, 'ride', 'rides')} on KerayeGo`;
}

/**
 * The owner's "This car has history on KerayeGo" notice (GET /my/vehicles/:id
 * plateHistory). Parts that are 0 or null are left out; null when nothing is
 * left to say (the backend already sends null in that case).
 */
export function plateHistoryText(history: PlateHistory | null | undefined): string | null {
  if (!history) return null;
  const parts: string[] = [];
  if (history.rideCount > 0) parts.push(plural(history.rideCount, 'ride', 'rides'));
  if (history.reviewCount > 0) {
    const reviews = plural(history.reviewCount, 'review', 'reviews');
    parts.push(history.averageRating !== null ? `★ ${history.averageRating.toFixed(1)} from ${reviews}` : reviews);
  }
  if (parts.length === 0) return null;
  return `This car has history on KerayeGo — ${parts.join(', ')}. Reviews stay with the car's plate.`;
}
