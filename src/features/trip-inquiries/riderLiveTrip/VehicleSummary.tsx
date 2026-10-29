import { View } from 'react-native';
import { Image } from 'expo-image';
import { AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';
import { titleCase } from '../../../utils/format';
import type { RiderTripVehicle } from './tripDisplay';

// The car the rider is looking for: cover photo (when there is one),
// year/make/model (a fleet car's listing title on a return trip), then colour
// and plate when known, and on a return trip which business operates it —
// everything needed to spot it at the pickup point.
export function VehicleSummary({ vehicle }: { vehicle: RiderTripVehicle }) {
  const { colors, spacing, radii } = useTheme();
  const { cover } = vehicle;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      {cover ? (
        <View style={{ width: 64, height: 64, borderRadius: radii.md, overflow: 'hidden', backgroundColor: colors.surfaceAlt }}>
          <Image
            source={{ uri: cover.url }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            accessibilityLabel={cover.altText ?? vehicle.name}
          />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <AppText variant="label" numberOfLines={1}>
          {vehicle.name}
        </AppText>
        {vehicle.color ? (
          <AppText muted variant="caption" numberOfLines={1}>
            {titleCase(vehicle.color)}
          </AppText>
        ) : null}
        {vehicle.plateNumber ? (
          <AppText variant="caption" style={{ marginTop: 2 }}>
            Plate {vehicle.plateNumber}
          </AppText>
        ) : null}
        {vehicle.operatedBy ? (
          <AppText muted variant="caption" numberOfLines={1} style={{ marginTop: 2 }}>
            Operated by {vehicle.operatedBy}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}
