import { View } from 'react-native';
import { Image } from 'expo-image';

import { AppCard, AppText, StatusBadge } from '../../../components/ui';
import { RatingBadge } from '../../../components/reviews/RatingBadge';
import { useTheme } from '../../../theme';
import { RideAvatar } from '../../liveRide/components/RideAvatar';
import { DriverContactActions } from '../../trip-inquiries/riderLiveTrip/DriverContactActions';
import type { RentalDriverCardInfo } from '../bookingDisplay';

const AVATAR_SIZE = 56;

// The rental's driver card (A86), once a driver is assigned: photo, name,
// their rating and rides, and what KerayeGo checked — "Identity verified",
// "Licence verified" (never "safe"; a check that didn't pass simply isn't
// shown). Call / WhatsApp while the booking is ACCEPTED and the driver has
// confirmed the job (D14); during the rental the live card has them.
export function RentalDriverCard({ driver, style }: { driver: RentalDriverCardInfo; style?: object }) {
  const { colors, spacing } = useTheme();
  const rated = driver.rating !== null || driver.rideCount > 0;

  return (
    <AppCard style={style}>
      <AppText muted variant="caption">
        Your driver
      </AppText>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm }}>
        {driver.avatarUrl ? (
          <Image
            source={{ uri: driver.avatarUrl }}
            style={{ width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2, backgroundColor: colors.surfaceAlt }}
            contentFit="cover"
            accessibilityLabel={`${driver.name}'s photo`}
          />
        ) : (
          <RideAvatar name={driver.name} size={AVATAR_SIZE} />
        )}
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <AppText variant="subtitle" numberOfLines={1}>
            {driver.name}
          </AppText>
          {rated ? (
            <RatingBadge
              average={driver.rating?.average ?? null}
              count={driver.rating?.count ?? 0}
              rideCount={driver.rideCount}
              size="sm"
            />
          ) : null}
        </View>
      </View>

      {driver.identityVerified || driver.licenceVerified ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
          {driver.identityVerified ? <StatusBadge label="✓ Identity verified" tone="success" /> : null}
          {driver.licenceVerified ? <StatusBadge label="✓ Licence verified" tone="success" /> : null}
        </View>
      ) : null}

      {driver.contactPhone ? (
        <View style={{ marginTop: spacing.md }}>
          <DriverContactActions callNumber={driver.contactPhone} whatsappNumber={driver.contactPhone} />
        </View>
      ) : driver.waitingForConfirmation ? (
        <AppText muted variant="caption" style={{ marginTop: spacing.sm }}>
          You can call your driver once they confirm the job.
        </AppText>
      ) : null}
    </AppCard>
  );
}
