import { FlatList, Pressable, View } from 'react-native';
import { router } from 'expo-router';

import { useMyTripInquiries } from '../../features/trip-inquiries/queries';
import { AppCard, AppRefreshControl, AppScreen, AppText, ErrorState, LoadingState } from '../../components/ui';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { EmptyState } from '../../components/ui/States';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import { useTheme } from '../../theme';
import { tripInquiryStatusMeta } from '../../types/enums';
import { titleCase } from '../../utils/format';

export default function MyTripRequestsScreen() {
  const { spacing } = useTheme();
  const { data, isLoading, isError, refetch } = useMyTripInquiries(1, 50);
  const refresh = usePullToRefresh(refetch);

  if (isLoading) return <LoadingState label="Loading your trip requests..." />;
  if (isError) return <ErrorState message="Couldn't load your trip requests." onRetry={refetch} />;

  return (
    <AppScreen edges={['left', 'right', 'bottom']}>
      <FlatList
        data={data?.data ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: spacing.lg, flexGrow: 1 }}
        refreshControl={<AppRefreshControl {...refresh} />}
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push(`/account/trip-request/${item.id}`)}>
            <AppCard style={{ marginBottom: spacing.md }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <AppText variant="label" style={{ flex: 1, marginRight: spacing.sm, textTransform: 'capitalize' }} numberOfLines={1}>
                  {titleCase(item.trip.originCity)} → {titleCase(item.trip.destinationCity)}
                </AppText>
                <StatusBadge label={tripInquiryStatusMeta[item.status].label} tone={tripInquiryStatusMeta[item.status].tone} />
              </View>
              <AppText muted variant="caption" style={{ marginTop: spacing.xs }}>
                {item.requestedSeats} seat{item.requestedSeats !== 1 ? 's' : ''} · {item.trip.postedBy.name}
              </AppText>
              <AppText muted variant="caption" style={{ marginTop: 2 }}>
                {new Date(item.trip.departureAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
              </AppText>
            </AppCard>
          </Pressable>
        )}
        ListEmptyComponent={<EmptyState title="No trip requests yet" description="Requests you send to drivers will appear here." />}
      />
    </AppScreen>
  );
}
