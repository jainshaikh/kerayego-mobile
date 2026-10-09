import { View } from 'react-native';
import { Image } from 'expo-image';
import { AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';
import type { TripInquiryVehicle } from '../../../api/trip-inquiries.api';
import { titleCase } from '../../../utils/format';
import { vehicleDisplayName } from './tripDisplay';

// The car the rider is looking for: cover photo (when the driver added one),
// year/make/model, then colour and plate — everything needed to spot it at
// the pickup point.
export function VehicleSummary({ vehicle }: { vehicle: TripInquiryVehicle }) {
  const { colors, spacing, radii } = useTheme();
  const cover = vehicle.images[0];
  const name = vehicleDisplayName(vehicle);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      {cover ? (
        <View style={{ width: 64, height: 64, borderRadius: radii.md, overflow: 'hidden', backgroundColor: colors.surfaceAlt }}>
          <Image
            source={{ uri: cover.url }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            accessibilityLabel={cover.altText ?? name}
          />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <AppText variant="label" numberOfLines={1}>
          {name}
        </AppText>
        {vehicle.color ? (
          <AppText muted variant="caption" numberOfLines={1}>
            {titleCase(vehicle.color)}
          </AppText>
        ) : null}
        <AppText variant="caption" style={{ marginTop: 2 }}>
          Plate {vehicle.plateNumber}
        </AppText>
      </View>
    </View>
  );
}
