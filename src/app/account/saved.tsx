import { FlatList, Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';

import { useRemoveSavedVehicle, useSavedVehicles } from '../../features/saved-vehicles/queries';
import { AppCard, AppRefreshControl, AppScreen, AppText, ErrorState, LoadingState } from '../../components/ui';
import { EmptyState } from '../../components/ui/States';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import { useTheme } from '../../theme';
import { formatPrice } from '../../utils/format';

export default function SavedVehiclesScreen() {
  const { colors, spacing } = useTheme();
  const { data, isLoading, isError, refetch } = useSavedVehicles();
  const removeSavedVehicle = useRemoveSavedVehicle();
  const refresh = usePullToRefresh(refetch);

  if (isLoading) return <LoadingState label="Loading saved vehicles..." />;
  if (isError) return <ErrorState message="Couldn't load your saved vehicles." onRetry={refetch} />;

  return (
    <AppScreen edges={['left', 'right', 'bottom']}>
      <FlatList
        data={data?.data ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: spacing.lg, flexGrow: 1 }}
        refreshControl={<AppRefreshControl {...refresh} />}
        renderItem={({ item }) => {
          const cover = item.vehicle.images[0];
          return (
            <AppCard style={{ flexDirection: 'row', marginBottom: spacing.md, padding: spacing.sm }}>
              <Pressable
                style={{ flexDirection: 'row', flex: 1 }}
                onPress={() => router.push(`/vehicle/${item.vehicle.slug}`)}
              >
                <View style={{ width: 88, height: 66, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.surfaceAlt }}>
                  {cover ? (
                    <Image source={{ uri: cover.url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                  ) : null}
                </View>
                <View style={{ marginLeft: spacing.md, flex: 1, justifyContent: 'center' }}>
                  <AppText variant="label" numberOfLines={1}>
                    {item.vehicle.title}
                  </AppText>
                  <AppText muted variant="caption">
                    {formatPrice(item.vehicle.pricePerDay)}/day
                  </AppText>
                </View>
              </Pressable>
              <Pressable
                onPress={() => removeSavedVehicle.mutate(item.vehicleId)}
                hitSlop={12}
                style={{ justifyContent: 'center', paddingHorizontal: spacing.sm }}
                accessibilityRole="button"
                accessibilityLabel="Remove from saved"
              >
                <AppText color={colors.danger} variant="caption">
                  Remove
                </AppText>
              </Pressable>
            </AppCard>
          );
        }}
        ListEmptyComponent={
          <EmptyState
            title="No saved vehicles yet"
            description="Tap the heart icon on any vehicle to save it here."
            actionLabel="Browse vehicles"
            onAction={() => router.push('/')}
          />
        }
      />
    </AppScreen>
  );
}
