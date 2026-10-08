import { FlatList, Pressable, View } from 'react-native';
import { router } from 'expo-router';

import { useMyTrips } from '../../../features/trips/queries';
import { AppButton, AppCard, AppRefreshControl, AppScreen, AppText, ErrorState, LoadingState, StatusBadge } from '../../../components/ui';
import { EmptyState } from '../../../components/ui/States';
import { usePullToRefresh } from '../../../hooks/usePullToRefresh';
import { useTheme } from '../../../theme';
import { tripStatusMeta } from '../../../types/enums';
import { formatPrice } from '../../../utils/format';

export default function MyTripsScreen() {
  const { spacing } = useTheme();
  const { data, isLoading, isError, refetch } = useMyTrips(1, 50);
  const refresh = usePullToRefresh(refetch);

  if (isLoading) return <LoadingState label="Loading your trips..." />;
  if (isError) return <ErrorState message="Couldn't load your trips." onRetry={refetch} />;

  return (
    <AppScreen edges={['left', 'right', 'bottom']}>
      <FlatList
        data={data?.data ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: spacing.lg, flexGrow: 1 }}
        refreshControl={<AppRefreshControl {...refresh} />}
        ListHeaderComponent={
          <AppButton title="Post a trip" onPress={() => router.push('/account/my-trips/new')} style={{ marginBottom: spacing.lg }} />
        }
        renderItem={({ item }) => {
          const statusMeta = tripStatusMeta[item.status];
          return (
            <Pressable onPress={() => router.push(`/account/my-trips/${item.id}`)}>
              <AppCard style={{ marginBottom: spacing.md }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <AppText variant="label" style={{ textTransform: 'capitalize' }}>
                    {item.originCity} → {item.destinationCity}
                  </AppText>
                  <StatusBadge label={statusMeta.label} tone={statusMeta.tone} />
                </View>
                <AppText muted variant="caption" style={{ marginTop: spacing.xs }}>
                  {new Date(item.departureAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  {' · '}
                  {formatPrice(item.pricePerSeat)}/seat
                </AppText>
              </AppCard>
            </Pressable>
          );
        }}
        ListEmptyComponent={<EmptyState title="No trips posted yet" description="Post a trip once you have an approved vehicle." />}
      />
    </AppScreen>
  );
}
