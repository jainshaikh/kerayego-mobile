import { Linking, ScrollView, View } from 'react-native';
import { AppButton, AppCard, AppText, DetailRow, StatusBadge } from '../../../components/ui';
import { useTheme } from '../../../theme';
import { RideAvatar } from '../../liveRide/components/RideAvatar';

interface DriverTabProps {
  driverName: string;
  driverPhone: string | null;
  riderConfirmedAtPickup: boolean;
  vehicleName: string;
  vehiclePlate: string;
  vehicleColor: string | null;
  vehicleYear: number | null;
  onOpenChat: () => void;
}

// Driver tab of the rider's live view: driver identity/contact (chat + call)
// and the vehicle they're riding in.
export function DriverTab({
  driverName,
  driverPhone,
  riderConfirmedAtPickup,
  vehicleName,
  vehiclePlate,
  vehicleColor,
  vehicleYear,
  onOpenChat,
}: DriverTabProps) {
  const { spacing } = useTheme();

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
      <View style={{ gap: spacing.md }}>
        <AppCard>
          <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
            <RideAvatar name={driverName} size={48} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <AppText variant="subtitle" numberOfLines={1}>
                {driverName}
              </AppText>
            </View>
            <StatusBadge label={riderConfirmedAtPickup ? 'On The Way' : 'En Route'} tone="accent" />
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
            <View style={{ flex: 1 }}>
              <AppButton title="Chat" onPress={onOpenChat} />
            </View>
            {driverPhone ? (
              <View style={{ flex: 1 }}>
                <AppButton title="Call" variant="outline" onPress={() => Linking.openURL(`tel:${driverPhone}`).catch(() => {})} />
              </View>
            ) : null}
          </View>
        </AppCard>

        <AppCard>
          <AppText variant="label" style={{ marginBottom: spacing.md }}>
            Vehicle
          </AppText>
          <View style={{ gap: spacing.md }}>
            <DetailRow label="Vehicle" value={vehicleYear ? `${vehicleYear} ${vehicleName}` : vehicleName} />
            {vehicleColor ? <DetailRow label="Colour" value={vehicleColor} /> : null}
            <DetailRow label="Plate" value={vehiclePlate} />
          </View>
        </AppCard>
      </View>
    </ScrollView>
  );
}
