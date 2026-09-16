import { useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { router } from 'expo-router';

import { useAuth } from '../../../auth/auth-context';
import { useInfiniteTrips, useTripRouteGroups } from '../../../features/trips/queries';
import { TripCard } from '../../../features/trips/components/TripCard';
import { TripFilterSheet } from '../../../features/trips/components/TripFilterSheet';
import { RouteGroupCard } from '../../../features/trips/components/RouteGroupCard';
import { AppButton, AppScreen, AppText, ErrorState, LoadingState } from '../../../components/ui';
import { EmptyState } from '../../../components/ui/States';
import { useTheme } from '../../../theme';
import { titleCase } from '../../../utils/format';
import type { TripFilters } from '../../../api/trips.api';

export default function TripsScreen() {
  const { colors, spacing } = useTheme();
  const { isAuthenticated } = useAuth();
  const [filters, setFilters] = useState<TripFilters>({});
  const [sheetVisible, setSheetVisible] = useState(false);

  const query = useInfiniteTrips(filters);
  const routeGroups = useTripRouteGroups();
  const trips = query.data?.pages.flatMap((page) => page.data) ?? [];
  const activeFilterCount = Object.values(filters).filter((v) => v !== undefined && v !== '').length;

  const lockedRoute =
    filters.originCity && filters.destinationCity
      ? routeGroups.data?.find(
          (r) => r.originCity === filters.originCity && r.destinationCity === filters.destinationCity,
        )
      : undefined;

  const selectRoute = (originCity: string, destinationCity: string) => {
    setFilters((f) => ({ ...f, originCity, destinationCity }));
  };

  const clearRoute = () => {
    setFilters((f) => {
      const { originCity, destinationCity, ...rest } = f;
      return rest;
    });
  };

  const handlePostTrip = () => {
    if (!isAuthenticated) {
      router.push({ pathname: '/login', params: { returnTo: '/account/my-trips/new' } });
      return;
    }
    router.push('/account/my-trips/new');
  };

  return (
    <AppScreen edges={['top', 'left', 'right']}>
      <View style={{ padding: spacing.lg, paddingBottom: spacing.sm, gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <AppText variant="title">Carpool</AppText>
          <AppButton title="Post a trip" fullWidth={false} onPress={handlePostTrip} />
        </View>
        <AppButton
          title={activeFilterCount > 0 ? `Filters (${activeFilterCount})` : 'Filters & sort'}
          variant="outline"
          fullWidth={false}
          onPress={() => setSheetVisible(true)}
        />
      </View>

      {lockedRoute ? (
        <View
          style={{
            marginHorizontal: spacing.lg,
            marginBottom: spacing.sm,
            padding: spacing.md,
            borderRadius: 12,
            backgroundColor: colors.surfaceAlt,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <AppText variant="label">
            {titleCase(lockedRoute.originCity)} → {titleCase(lockedRoute.destinationCity)} · {lockedRoute.tripCount}{' '}
            {lockedRoute.tripCount === 1 ? 'trip' : 'trips'}
          </AppText>
          <AppButton title="Clear" variant="ghost" fullWidth={false} onPress={clearRoute} />
        </View>
      ) : routeGroups.data && routeGroups.data.length > 0 ? (
        <View style={{ marginBottom: spacing.sm }}>
          <AppText variant="label" style={{ marginHorizontal: spacing.lg, marginBottom: spacing.sm }}>
            Popular routes
          </AppText>
          <FlatList
            data={routeGroups.data}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item) => `${item.originCity}-${item.destinationCity}`}
            contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}
            renderItem={({ item }) => (
              <RouteGroupCard route={item} onPress={() => selectRoute(item.originCity, item.destinationCity)} />
            )}
          />
        </View>
      ) : null}

      {query.isLoading ? (
        <LoadingState label="Loading trips..." />
      ) : query.isError ? (
        <ErrorState message="Couldn't load trips." onRetry={() => query.refetch()} />
      ) : (
        <FlatList
          data={trips}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing.lg, paddingTop: 0, flexGrow: 1 }}
          renderItem={({ item }) => <TripCard trip={item} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage();
          }}
          ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator style={{ marginVertical: spacing.md }} /> : null}
          ListEmptyComponent={
            <EmptyState title="No trips found" description="Try adjusting your filters, or post your own trip." />
          }
        />
      )}

      <TripFilterSheet visible={sheetVisible} onClose={() => setSheetVisible(false)} filters={filters} onApply={setFilters} />
    </AppScreen>
  );
}
