import { FlatList, Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import { usePublicProvider } from '../../../features/providers/queries';
import { RatingSummaryBadge } from '../../../components/reviews/RatingSummaryBadge';
import { ReviewsList } from '../../../components/reviews/ReviewsList';
import { AppCard, AppRefreshControl, AppScreen, AppText, ErrorState, LoadingState } from '../../../components/ui';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { usePullToRefresh } from '../../../hooks/usePullToRefresh';
import { useTheme } from '../../../theme';
import { formatPrice } from '../../../utils/format';

// Route param is named `id` to match the reference folder structure, but the
// backend looks providers up by slug (GET /providers/:slug).
export default function ProviderProfileScreen() {
  const { id: slug } = useLocalSearchParams<{ id: string }>();
  const { colors, spacing, radii } = useTheme();
  const { data: provider, isLoading, isError, refetch } = usePublicProvider(slug);
  const queryClient = useQueryClient();
  // Reviews and rating badges on this screen are their own queries, owned by
  // child components — invalidating ['reviews'] refetches the mounted ones.
  const refresh = usePullToRefresh(() =>
    Promise.all([refetch(), queryClient.invalidateQueries({ queryKey: ['reviews'] })]),
  );

  if (isLoading) return <LoadingState label="Loading provider..." />;
  if (isError || !provider) {
    return <ErrorState message="This provider may no longer be available." onRetry={refetch} />;
  }

  return (
    <AppScreen edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: provider.businessName }} />
      <FlatList
        data={provider.vehicles}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: spacing.lg }}
        numColumns={2}
        columnWrapperStyle={{ gap: spacing.md }}
        refreshControl={<AppRefreshControl {...refresh} />}
        ListHeaderComponent={
          <View style={{ marginBottom: spacing.lg }}>
            {provider.bannerUrl ? (
              <Image
                source={{ uri: provider.bannerUrl }}
                style={{ width: '100%', aspectRatio: 21 / 9, borderRadius: radii.lg, marginBottom: spacing.md }}
                contentFit="cover"
              />
            ) : null}

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              {provider.logoUrl ? (
                <Image
                  source={{ uri: provider.logoUrl }}
                  style={{ width: 56, height: 56, borderRadius: radii.md, backgroundColor: colors.surfaceAlt }}
                  contentFit="cover"
                />
              ) : null}
              <View style={{ flex: 1 }}>
                <AppText variant="title">{provider.businessName}</AppText>
                {provider.isFeatured ? <StatusBadge label="Featured" tone="info" /> : null}
                <View style={{ marginTop: spacing.xs }}>
                  <RatingSummaryBadge subjectType="PROVIDER" subjectId={provider.id} size="sm" />
                </View>
              </View>
            </View>

            {provider.businessDescription ? (
              <AppText muted style={{ marginTop: spacing.md }}>
                {provider.businessDescription}
              </AppText>
            ) : null}

            {provider.showrooms.map((showroom) => (
              <AppCard key={showroom.id} style={{ marginTop: spacing.md }}>
                <AppText variant="label">{showroom.name}</AppText>
                <AppText muted variant="caption" style={{ marginTop: 2 }}>
                  {showroom.address}
                </AppText>
                <AppText muted variant="caption" style={{ marginTop: 2, textTransform: 'capitalize' }}>
                  {showroom.city}
                  {showroom.area ? `, ${showroom.area}` : ''}
                </AppText>
                <AppText variant="caption" color={colors.primary} style={{ marginTop: spacing.xs }}>
                  {showroom.contactNumber}
                </AppText>
              </AppCard>
            ))}

            <AppText variant="subtitle" style={{ marginTop: spacing.lg, marginBottom: spacing.sm }}>
              Fleet ({provider._count.vehicles})
            </AppText>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            style={{ flex: 1, marginBottom: spacing.md }}
            onPress={() => router.push(`/vehicle/${item.slug}`)}
          >
            <AppCard style={{ padding: 0, overflow: 'hidden' }}>
              <Image
                source={{ uri: item.images[0]?.url }}
                style={{ width: '100%', aspectRatio: 4 / 3, backgroundColor: colors.surfaceAlt }}
                contentFit="cover"
              />
              <View style={{ padding: spacing.sm }}>
                <AppText variant="caption" numberOfLines={1}>
                  {item.title}
                </AppText>
                <AppText variant="caption" color={colors.primary}>
                  {formatPrice(item.pricePerDay)}/day
                </AppText>
              </View>
            </AppCard>
          </Pressable>
        )}
        ListEmptyComponent={<AppText muted>No published vehicles yet.</AppText>}
        ListFooterComponent={
          <AppCard style={{ marginTop: spacing.lg }}>
            <ReviewsList subjectType="PROVIDER" subjectId={provider.id} title="Reviews" />
          </AppCard>
        }
      />
    </AppScreen>
  );
}
