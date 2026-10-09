import { View } from 'react-native';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';

import { useUserVehicle } from '../../../features/user-vehicles/queries';
import {
  USER_VEHICLE_DOCUMENT_LABELS,
  USER_VEHICLE_DOCUMENT_TYPES,
  documentReviewBadge,
  documentsByType,
} from '../../../features/user-vehicles/userVehicleDraft';
import {
  AppButton,
  AppCard,
  AppRefreshControl,
  AppScreen,
  AppText,
  ErrorState,
  LoadingState,
  Row,
  StatusBadge,
} from '../../../components/ui';
import { usePullToRefresh } from '../../../hooks/usePullToRefresh';
import { useTheme } from '../../../theme';
import { MARKETS } from '../../../constants/markets';
import { DocumentStatus, UserVehicleStatus, userVehicleStatusMeta } from '../../../types/enums';
import { titleCase } from '../../../utils/format';

export default function UserVehicleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, spacing, tones } = useTheme();
  const { data: vehicle, isError, refetch } = useUserVehicle(id);
  const refresh = usePullToRefresh(refetch);

  // A failed background refetch (a pull-to-refresh offline, or the one that
  // follows a save) keeps showing the vehicle already loaded.
  if (!vehicle) {
    return isError ? (
      <ErrorState message="Couldn't load this vehicle." onRetry={refetch} />
    ) : (
      <LoadingState label="Loading vehicle..." />
    );
  }

  const statusMeta = userVehicleStatusMeta[vehicle.status];
  const documents = documentsByType(vehicle.documents);
  // Edit/resubmit is offered exactly where PATCH /my/vehicles/:id accepts it.
  const openEdit = () => router.push({ pathname: '/account/my-vehicles/edit/[id]', params: { id: vehicle.id } });

  return (
    <AppScreen
      scroll
      contentContainerStyle={{ padding: spacing.lg }}
      refreshControl={<AppRefreshControl {...refresh} />}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg }}>
        <AppText variant="title">
          {titleCase(vehicle.make)} {titleCase(vehicle.model)}
        </AppText>
        <StatusBadge label={statusMeta.label} tone={statusMeta.tone} />
      </View>

      {vehicle.status === UserVehicleStatus.REJECTED ? (
        <AppCard style={{ marginBottom: spacing.lg, backgroundColor: tones.danger.bg, borderColor: colors.danger }}>
          <AppText variant="label" color={tones.danger.fg}>
            Not approved
          </AppText>
          {vehicle.rejectionReason ? (
            <AppText color={tones.danger.fg} style={{ marginTop: spacing.xs }}>
              {vehicle.rejectionReason}
            </AppText>
          ) : null}
          <AppText variant="caption" color={tones.danger.fg} style={{ marginTop: spacing.sm }}>
            Fix the details, photos or documents and resubmit — our team reviews it again.
          </AppText>
          <AppButton title="Edit & resubmit" onPress={openEdit} style={{ marginTop: spacing.md }} />
        </AppCard>
      ) : null}

      {vehicle.status === UserVehicleStatus.PENDING_REVIEW ? (
        <AppCard style={{ marginBottom: spacing.lg }}>
          <AppText variant="label">Under review</AppText>
          <AppText muted variant="caption" style={{ marginTop: spacing.xs }}>
            Our team is checking your documents. Spotted a mistake? You can still edit it — saving puts it back at the
            end of the review queue.
          </AppText>
          <AppButton title="Edit" variant="outline" onPress={openEdit} style={{ marginTop: spacing.md }} />
        </AppCard>
      ) : null}

      <AppCard style={{ marginBottom: spacing.lg }}>
        {vehicle.year ? <Row label="Year" value={String(vehicle.year)} /> : null}
        {vehicle.color ? <Row label="Color" value={titleCase(vehicle.color)} /> : null}
        <Row label="Plate number" value={vehicle.plateNumber} />
        {vehicle.country ? <Row label="Country" value={MARKETS[vehicle.country]?.label ?? vehicle.country} /> : null}
      </AppCard>

      {vehicle.images.length > 0 ? (
        <View style={{ marginBottom: spacing.lg }}>
          <AppText variant="label" style={{ marginBottom: spacing.sm }}>
            Photos
          </AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {vehicle.images.map((image, index) => (
              <View key={image.id} style={{ width: 90, height: 90, borderRadius: 8, overflow: 'hidden' }}>
                <Image source={{ uri: image.url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                {index === 0 ? (
                  <View
                    style={{
                      position: 'absolute',
                      left: 4,
                      top: 4,
                      backgroundColor: 'rgba(0,0,0,0.6)',
                      borderRadius: 4,
                      paddingHorizontal: 4,
                      paddingVertical: 1,
                    }}
                  >
                    <AppText variant="caption" color="#fff" style={{ fontSize: 10 }}>
                      Poster
                    </AppText>
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <AppText variant="label" style={{ marginBottom: spacing.sm }}>
        Documents
      </AppText>
      {USER_VEHICLE_DOCUMENT_TYPES.map((type) => {
        const doc = documents[type];
        if (!doc) {
          // Registration requires all four, but an older record may lack one —
          // editing the vehicle is how it gets added.
          return (
            <AppCard key={type} style={{ marginBottom: spacing.sm }}>
              <AppText variant="label">{USER_VEHICLE_DOCUMENT_LABELS[type]}</AppText>
              <AppText muted variant="caption" style={{ marginTop: spacing.xs }}>
                Not uploaded
              </AppText>
            </AppCard>
          );
        }
        const badge = documentReviewBadge(doc, vehicle.status);
        const rejected = doc.status === DocumentStatus.REJECTED;
        return (
          <AppCard
            key={doc.id}
            style={{ marginBottom: spacing.sm, ...(rejected ? { borderColor: colors.danger } : null) }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
              <AppText variant="label" style={{ flex: 1 }}>
                {USER_VEHICLE_DOCUMENT_LABELS[type]}
              </AppText>
              {badge ? <StatusBadge label={badge.label} tone={badge.tone} /> : null}
            </View>
            {doc.rejectionReason ? (
              <AppText variant="caption" color={rejected ? colors.danger : undefined} muted style={{ marginTop: spacing.xs }}>
                {doc.rejectionReason}
              </AppText>
            ) : null}
          </AppCard>
        );
      })}
    </AppScreen>
  );
}
