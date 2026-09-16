import { useRatingSummary } from '../../features/reviews/queries';
import type { ReviewSubjectType } from '../../api/reviews.api';
import { RatingBadge } from './RatingBadge';

interface RatingSummaryBadgeProps {
  subjectType: ReviewSubjectType;
  subjectId: string | undefined;
  size?: 'sm' | 'md';
}

// Small wired component dropped into detail screens — fetches and renders a
// subject's public rating summary ("★ 4.8 (23)" or "No ratings yet").
export function RatingSummaryBadge({ subjectType, subjectId, size }: RatingSummaryBadgeProps) {
  const { data, isLoading } = useRatingSummary(subjectType, subjectId);
  if (isLoading || !subjectId) return null;
  return (
    <RatingBadge
      average={data?.average ?? null}
      count={data?.count ?? 0}
      tripsCount={data?.completedTripsCount}
      size={size}
    />
  );
}
