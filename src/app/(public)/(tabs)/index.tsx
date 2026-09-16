import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native';

import { useInfiniteListings } from '../../../features/listings/queries';
import { useSavedVehicles } from '../../../features/saved-vehicles/queries';
import { VehicleCard } from '../../../features/listings/components/VehicleCard';
import { FilterSheet } from '../../../features/listings/components/FilterSheet';
import { AppButton, AppInput, AppScreen, AppText, ErrorState, LoadingState } from '../../../components/ui';
import { EmptyState } from '../../../components/ui/States';
import { NearMeControl } from '../../../components/maps/NearMeControl';
import { useCurrentLocation } from '../../../hooks/useCurrentLocation';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useAuth } from '../../../auth/auth-context';
import { useTheme } from '../../../theme';
import { DEFAULT_NEARBY_RADIUS_KM } from '../../../constants/config';
import type { ListingFilters } from '../../../api/listings.api';

// The Vehicles tab IS the landing page — a directly browsable, filterable list,
// not a separate hero/featured teaser screen.
export default function VehiclesScreen() {
  const { colors, spacing } = useTheme();
  const { isAuthenticated } = useAuth();
  const [searchText, setSearchText] = useState('');
  // The TextInput below stays bound to searchText (instant, every keystroke)
  // — only this debounced value feeds the actual query, so typing a whole
  // phrase doesn't fire a fetch per character.
  const debouncedSearchText = useDebouncedValue(searchText);
  const [filters, setFilters] = useState<ListingFilters>({});
  const [sheetVisible, setSheetVisible] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [radiusKm, setRadiusKm] = useState(DEFAULT_NEARBY_RADIUS_KM);
  const location = useCurrentLocation();

  const appliedFilters = useMemo(
    () => ({
      ...filters,
      search: debouncedSearchText || undefined,
      lat: location.coords?.lat,
      lng: location.coords?.lng,
      radiusKm: location.coords ? radiusKm : undefined,
    }),
    [filters, debouncedSearchText, location.coords, radiusKm],
  );
  const query = useInfiniteListings(appliedFilters);
  const saved = useSavedVehicles();

  const vehicles = favoritesOnly
    ? (saved.data?.data.map((entry) => entry.vehicle) ?? [])
    : (query.data?.pages.flatMap((page) => page.data) ?? []);
  const activeFilterCount = Object.values(filters).filter((v) => v !== undefined && v !== '').length;

  const handleNearMe = async () => {
    const coords = await location.requestLocation();
    if (coords) setFilters((f) => ({ ...f, city: undefined }));
  };

  return (
    <AppScreen edges={['top', 'left', 'right']}>
      <View style={{ padding: spacing.lg, paddingBottom: spacing.sm, gap: spacing.sm }}>
        <AppText variant="title">Vehicles</AppText>
        <AppInput
          placeholder="Search by title, make, or model"
          value={searchText}
          onChangeText={setSearchText}
          returnKeyType="search"
          style={{ marginBottom: 0 }}
        />
        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' }}>
          <AppButton
            title={activeFilterCount > 0 ? `Filters (${activeFilterCount})` : 'Filters & sort'}
            variant="outline"
            fullWidth={false}
            onPress={() => setSheetVisible(true)}
          />
          <NearMeControl
            active={!!location.coords}
            loading={location.loading}
            error={location.error}
            onActivate={handleNearMe}
            onClear={location.clearLocation}
          />
        </View>
        {isAuthenticated ? (
          <Pressable
            onPress={() => setFavoritesOnly((v) => !v)}
            style={{
              alignSelf: 'flex-start',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.xs,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: favoritesOnly ? colors.primary : colors.border,
              backgroundColor: favoritesOnly ? colors.primary : 'transparent',
            }}
          >
            <AppText variant="caption" color={favoritesOnly ? colors.primaryText : colors.text}>
              {favoritesOnly ? '♥ My favorites' : '♡ My favorites'}
            </AppText>
          </Pressable>
        ) : null}
      </View>

      {!favoritesOnly && query.isFetching && !query.isLoading ? (
        // A search/filter change swaps the query key entirely, but
        // placeholderData keeps the previous results on screen while the new
        // ones load — this just signals that a refresh is in progress,
        // instead of replacing the list with a full loading skeleton.
        <View style={{ paddingHorizontal: spacing.lg, marginBottom: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          <ActivityIndicator size="small" color={colors.primary} />
          <AppText muted variant="caption">
            Updating…
          </AppText>
        </View>
      ) : null}

      {favoritesOnly ? (
        saved.isLoading ? (
          <LoadingState label="Loading your favorites..." />
        ) : saved.isError ? (
          <ErrorState message="Couldn't load your favorites." onRetry={() => saved.refetch()} />
        ) : (
          <FlatList
            data={vehicles}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: spacing.lg, paddingTop: 0, flexGrow: 1 }}
            renderItem={({ item }) => <VehicleCard vehicle={item} />}
            ListEmptyComponent={
              <EmptyState title="No favorites yet" description="Tap the heart on a vehicle to save it here." />
            }
          />
        )
      ) : query.isLoading ? (
        <LoadingState label="Loading vehicles..." />
      ) : query.isError ? (
        <ErrorState message="Couldn't load vehicles." onRetry={() => query.refetch()} />
      ) : (
        <FlatList
          data={vehicles}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing.lg, paddingTop: 0, flexGrow: 1 }}
          renderItem={({ item }) => <VehicleCard vehicle={item} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage();
          }}
          ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator style={{ marginVertical: spacing.md }} /> : null}
          ListEmptyComponent={
            <EmptyState title="No vehicles found" description="Try adjusting your search or filters." />
          }
        />
      )}

      <FilterSheet
        visible={sheetVisible}
        onClose={() => setSheetVisible(false)}
        filters={filters}
        onApply={setFilters}
        locationActive={!!location.coords}
        radiusKm={radiusKm}
        onApplyRadius={setRadiusKm}
        onApplyLocation={location.setManualLocation}
        onClearLocation={location.clearLocation}
      />
    </AppScreen>
  );
}
