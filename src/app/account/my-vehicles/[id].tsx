import { View } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';

import { useUserVehicle } from '../../../features/user-vehicles/queries';
import { AppCard, AppScreen, AppText, ErrorState, LoadingState, Row, StatusBadge } from '../../../components/ui';
import { useTheme } from '../../../theme';
import { userVehicleStatusMeta } from '../../../types/enums';
import { titleCase } from '../../../utils/format';

const DOCUMENT_LABELS: Record<string, string> = {
  ID_DOCUMENT: 'CNIC / National ID',
  ID_DOCUMENT_FRONT: 'CNIC / National ID — front',
  ID_DOCUMENT_BACK: 'CNIC / National ID — back',
  DRIVING_LICENSE: 'Driving license',
  VEHICLE_REGISTRATION: 'Vehicle registration',
};

export default function UserVehicleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, spacing } = useTheme();
  const { data: vehicle, isLoading, isError, refetch } = useUserVehicle(id);

  if (isLoading) return <LoadingState label="Loading vehicle..." />;
  if (isError || !vehicle) return <ErrorState message="Couldn't load this vehicle." onRetry={refetch} />;

  const statusMeta = userVehicleStatusMeta[vehicle.status];

  return (
    <AppScreen scroll contentContainerStyle={{ padding: spacing.lg }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg }}>
        <AppText variant="title">
          {titleCase(vehicle.make)} {titleCase(vehicle.model)}
        </AppText>
        <StatusBadge label={statusMeta.label} tone={statusMeta.tone} />
      </View>

      {vehicle.rejectionReason ? (
        <AppCard style={{ marginBottom: spacing.lg }}>
          <AppText variant="label" color={colors.danger}>
            Rejection reason
          </AppText>
          <AppText muted style={{ marginTop: spacing.xs }}>
            {vehicle.rejectionReason}
          </AppText>
        </AppCard>
      ) : null}

      <AppCard style={{ marginBottom: spacing.lg }}>
        {vehicle.year ? <Row label="Year" value={String(vehicle.year)} /> : null}
        {vehicle.color ? <Row label="Color" value={titleCase(vehicle.color)} /> : null}
        <Row label="Plate number" value={vehicle.plateNumber} />
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
      {vehicle.documents.map((doc) => (
        <AppCard key={doc.id} style={{ marginBottom: spacing.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <AppText variant="label">{DOCUMENT_LABELS[doc.documentType] ?? doc.documentType}</AppText>
            <StatusBadge
              label={doc.status}
              tone={doc.status === 'APPROVED' ? 'success' : doc.status === 'REJECTED' ? 'danger' : 'warning'}
            />
          </View>
          {doc.rejectionReason ? (
            <AppText muted variant="caption" style={{ marginTop: spacing.xs }}>
              {doc.rejectionReason}
            </AppText>
          ) : null}
        </AppCard>
      ))}
    </AppScreen>
  );
}
