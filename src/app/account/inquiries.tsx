import { FlatList, Pressable, View } from 'react-native';
import { router } from 'expo-router';

import { useMyBookingRequests } from '../../features/booking-requests/queries';
import { AppCard, AppRefreshControl, AppScreen, AppText, ErrorState, LoadingState } from '../../components/ui';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { EmptyState } from '../../components/ui/States';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import { useTheme } from '../../theme';
import { bookingStatusMeta } from '../../types/enums';
import { formatDate } from '../../utils/format';

export default function MyInquiriesScreen() {
  const { spacing } = useTheme();
  const { data, isLoading, isError, refetch } = useMyBookingRequests(1, 50);
  const refresh = usePullToRefresh(refetch);

  if (isLoading) return <LoadingState label="Loading your inquiries..." />;
  if (isError) return <ErrorState message="Couldn't load your inquiries." onRetry={refetch} />;

  return (
    <AppScreen edges={['left', 'right', 'bottom']}>
      <FlatList
        data={data?.data ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: spacing.lg, flexGrow: 1 }}
        refreshControl={<AppRefreshControl {...refresh} />}
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push(`/account/inquiry/${item.id}`)}>
            <AppCard style={{ marginBottom: spacing.md }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <AppText variant="label" style={{ flex: 1, marginRight: spacing.sm }} numberOfLines={1}>
                  {item.vehicle.title}
                </AppText>
                <StatusBadge label={bookingStatusMeta[item.status].label} tone={bookingStatusMeta[item.status].tone} />
              </View>
              <AppText muted variant="caption" style={{ marginTop: spacing.xs }}>
                {formatDate(item.requestedFromDate)} – {formatDate(item.requestedToDate)}
              </AppText>
              <AppText muted variant="caption" style={{ marginTop: 2 }}>
                {item.providerProfile.businessName}
              </AppText>
            </AppCard>
          </Pressable>
        )}
        ListEmptyComponent={<EmptyState title="No inquiries yet" description="Your booking inquiries will appear here." />}
      />
    </AppScreen>
  );
}
