import { useState } from 'react';

// Drives a screen's pull-to-refresh spinner (pair with AppRefreshControl).
// `refreshing` is local state on purpose, not a query's isFetching/isRefetching
// — those also flip for background refetches (polling, invalidation after a
// mutation), which would flash the pull spinner when nobody pulled anything.
// `refresh` should resolve once every query the screen shows has refetched,
// e.g. `() => Promise.all([listQuery.refetch(), countsQuery.refetch()])`.
export function usePullToRefresh(refresh: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  return { refreshing, onRefresh };
}
