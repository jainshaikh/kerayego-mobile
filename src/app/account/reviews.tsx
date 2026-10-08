import { EligibleReviewsList } from '../../features/reviews/components/EligibleReviewsList';
import { useMyEligibleReviews } from '../../features/reviews/queries';
import { AppRefreshControl, AppScreen } from '../../components/ui';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';

export default function ReviewsScreen() {
  // Same query (and cache entry) EligibleReviewsList renders from — this
  // instance only exists to drive the pull-to-refresh.
  const { refetch } = useMyEligibleReviews();
  const refresh = usePullToRefresh(refetch);

  return (
    <AppScreen scroll edges={['left', 'right', 'bottom']} refreshControl={<AppRefreshControl {...refresh} />}>
      <EligibleReviewsList />
    </AppScreen>
  );
}
