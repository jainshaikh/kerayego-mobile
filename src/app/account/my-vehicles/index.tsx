import { FlatList, Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';

import { useMyUserVehicles } from '../../../features/user-vehicles/queries';
import { AppButton, AppCard, AppRefreshControl, AppScreen, AppText, ErrorState, LoadingState, StatusBadge } from '../../../components/ui';
import { EmptyState } from '../../../components/ui/States';
import { usePullToRefresh } from '../../../hooks/usePullToRefresh';
import { useTheme } from '../../../theme';
import { userVehicleStatusMeta } from '../../../types/enums';
import { titleCase } from '../../../utils/format';

export default function MyVehiclesScreen() {
  const { colors, spacing } = useTheme();
  const { data, isLoading, isError, refetch } = useMyUserVehicles();
  const refresh = usePullToRefresh(refetch);

  if (isLoading) return <LoadingState label="Loading your vehicles..." />;
  if (isError) return <ErrorState message="Couldn't load your vehicles." onRetry={refetch} />;

  return (
    <AppScreen edges={['left', 'right', 'bottom']}>
      <FlatList
        data={data ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: spacing.lg, flexGrow: 1 }}
        refreshControl={<AppRefreshControl {...refresh} />}
        ListHeaderComponent={
          <AppButton
            title="Register a vehicle"
            onPress={() => router.push('/account/my-vehicles/new')}
            style={{ marginBottom: spacing.lg }}
          />
        }
        renderItem={({ item }) => {
          const statusMeta = userVehicleStatusMeta[item.status];
          const cover = item.images[0];
          return (
            <Pressable onPress={() => router.push(`/account/my-vehicles/${item.id}`)}>
              <AppCard style={{ flexDirection: 'row', marginBottom: spacing.md, padding: spacing.sm }}>
                {cover ? (
                  <View style={{ width: 64, height: 64, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.surfaceAlt }}>
                    <Image source={{ uri: cover.url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                  </View>
                ) : null}
                <View style={{ marginLeft: cover ? spacing.md : 0, flex: 1, justifyContent: 'center' }}>
                  <AppText variant="label">
                    {titleCase(item.make)} {titleCase(item.model)}
                    {item.year ? ` (${item.year})` : ''}
                  </AppText>
                  <AppText muted variant="caption" style={{ marginTop: 2, marginBottom: spacing.xs }}>
                    Plate: {item.plateNumber}
                  </AppText>
                  <View>
                    <StatusBadge label={statusMeta.label} tone={statusMeta.tone} />
                  </View>
                </View>
              </AppCard>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <EmptyState
            title="No vehicles registered"
            description="Register a personal vehicle to start posting intercity trips."
          />
        }
      />
    </AppScreen>
  );
}
