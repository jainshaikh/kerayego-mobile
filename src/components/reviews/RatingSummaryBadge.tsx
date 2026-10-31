import { useRatingSummary } from '../../features/reviews/queries';
import type { ReviewSubjectType } from '../../api/reviews.api';
import { RatingBadge } from './RatingBadge';

interface RatingSummaryBadgeProps {
  subjectType: ReviewSubjectType;
  subjectId: string | undefined;
  size?: 'sm' | 'md';
}

// Small wired component dropped into detail screens — fetches and renders a
// subject's public rating summary ("★ 4.8 (23)" or "No ratings yet"). For a
// car (VEHICLE / USER_VEHICLE) it adds the plate's "N rides on KerayeGo".
export function RatingSummaryBadge({ subjectType, subjectId, size }: RatingSummaryBadgeProps) {
  const { data, isLoading } = useRatingSummary(subjectType, subjectId);
  if (isLoading || !subjectId) return null;
  const isCar = subjectType === 'VEHICLE' || subjectType === 'USER_VEHICLE';
  return (
    <RatingBadge
      average={data?.average ?? null}
      count={data?.count ?? 0}
      tripsCount={data?.completedTripsCount}
      rideCount={isCar ? data?.rideCount : undefined}
      size={size}
    />
  );
}
