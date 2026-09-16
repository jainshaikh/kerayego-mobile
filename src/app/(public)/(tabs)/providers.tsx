import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native';

import { useInfiniteProviders } from '../../../features/providers/queries';
import { useCities } from '../../../features/listings/queries';
import { ProviderCard } from '../../../features/providers/components/ProviderCard';
import { FilterChipRow } from '../../../features/listings/components/FilterChipRow';
import { LocationField } from '../../../features/location/components/LocationField';
import { AppScreen, AppText, ErrorState, LoadingState } from '../../../components/ui';
import { EmptyState } from '../../../components/ui/States';
import { NearMeControl } from '../../../components/maps/NearMeControl';
import { useCurrentLocation } from '../../../hooks/useCurrentLocation';
import { useTheme } from '../../../theme';
import { DEFAULT_NEARBY_RADIUS_KM, NEARBY_RADIUS_OPTIONS_KM } from '../../../constants/config';
import type { ProviderFilters } from '../../../api/providers.api';

const LOCATION_REGION_CODES = ['PK', 'AE', 'SA'];

export default function ProvidersScreen() {
  const { colors, spacing, radii } = useTheme();
  const [cityFilter, setCityFilter] = useState<string | undefined>(undefined);
  const [locationText, setLocationText] = useState('');
  const [radiusKm, setRadiusKm] = useState(DEFAULT_NEARBY_RADIUS_KM);
  const cities = useCities();
  const location = useCurrentLocation();

  const filters: ProviderFilters = useMemo(
    () => ({
      city: location.coords ? undefined : cityFilter,
      lat: location.coords?.lat,
      lng: location.coords?.lng,
      radiusKm: location.coords ? radiusKm : undefined,
    }),
    [cityFilter, location.coords, radiusKm],
  );

  const query = useInfiniteProviders(filters);
  const providers = query.data?.pages.flatMap((page) => page.data) ?? [];

  const cityOptions = (cities.data ?? []).map((c) => ({ label: c, value: c }));

  const handleNearMe = async () => {
    const coords = await location.requestLocation();
    if (coords) setCityFilter(undefined);
  };

  const handleClearLocation = () => {
    location.clearLocation();
    setLocationText('');
  };

  return (
    <AppScreen edges={['top', 'left', 'right']}>
      <View style={{ padding: spacing.lg, paddingBottom: spacing.sm, gap: spacing.sm }}>
        <AppText variant="title">Providers</AppText>
        <AppText muted variant="caption">
          Rental businesses you can book with
        </AppText>
        <NearMeControl
          active={!!location.coords}
          loading={location.loading}
          error={location.error}
          onActivate={handleNearMe}
          onClear={handleClearLocation}
        />
      </View>

      <View style={{ paddingHorizontal: spacing.lg, marginBottom: spacing.sm, gap: spacing.sm }}>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <AppText variant="label">Find providers near a location</AppText>
          {location.coords ? (
            <Pressable onPress={handleClearLocation}>
              <AppText variant="caption" color={colors.primary}>
                Clear
              </AppText>
            </Pressable>
          ) : null}
        </View>
        <LocationField
          value={locationText}
          onChangeText={setLocationText}
          onLocationChange={(lat, lng) => {
            setCityFilter(undefined);
            location.setManualLocation(lat, lng);
          }}
          placeholder="Search a city or area"
          regionCodes={LOCATION_REGION_CODES}
          showMapPicker={false}
        />

        {location.coords ? (
          <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
            {NEARBY_RADIUS_OPTIONS_KM.map((option) => {
              const selected = option === radiusKm;
              return (
                <Pressable
                  key={option}
                  onPress={() => setRadiusKm(option)}
                  style={{
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.xs,
                    borderRadius: radii.full,
                    borderWidth: 1,
                    borderColor: selected ? colors.primary : colors.border,
                    backgroundColor: selected ? colors.primary : 'transparent',
                  }}
                >
                  <AppText variant="caption" color={selected ? colors.primaryText : colors.text}>
                    {option} km
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        ) : cityOptions.length > 0 ? (
          <FilterChipRow options={cityOptions} value={cityFilter} onChange={setCityFilter} />
        ) : null}
      </View>

      {query.isLoading ? (
        <LoadingState label="Loading providers..." />
      ) : query.isError ? (
        <ErrorState message="Couldn't load providers." onRetry={() => query.refetch()} />
      ) : (
        <FlatList
          data={providers}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing.lg, paddingTop: 0, flexGrow: 1 }}
          renderItem={({ item }) => <ProviderCard provider={item} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage();
          }}
          ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator style={{ marginVertical: spacing.md }} /> : null}
          ListEmptyComponent={<EmptyState title="No providers found" description="Try a different city." />}
        />
      )}
    </AppScreen>
  );
}
