import { ScrollView, View } from 'react-native';
import { AppCard, AppText, StatusBadge } from '../../../components/ui';
import { useTheme } from '../../../theme';
import type { TripInquiryVehicle } from '../../../api/trip-inquiries.api';
import { RideAvatar } from '../../liveRide/components/RideAvatar';
import { DriverContactActions } from './DriverContactActions';
import type { BadgeCopy } from './riderTripState';
import { VehicleSummary } from './VehicleSummary';

interface DriverTabProps {
  driverName: string;
  // Follows the ride phase (see liveRideCopy).
  driverBadge: BadgeCopy;
  // driverCallNumber(trip): the driver's own phone, else the listing's number.
  callNumber: string | null;
  whatsappNumber: string | null;
  vehicle: TripInquiryVehicle;
  onOpenChat: () => void;
}

// Driver tab of the rider's live view: driver identity/contact (chat, call,
// WhatsApp) and the vehicle they're riding in — straight from the rider's own
// request, which always carries it.
export function DriverTab({ driverName, driverBadge, callNumber, whatsappNumber, vehicle, onOpenChat }: DriverTabProps) {
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
            <StatusBadge label={driverBadge.label} tone={driverBadge.tone} />
          </View>
          <View style={{ marginTop: spacing.md }}>
            <DriverContactActions callNumber={callNumber} whatsappNumber={whatsappNumber} onOpenChat={onOpenChat} />
          </View>
        </AppCard>

        <AppCard>
          <AppText variant="label" style={{ marginBottom: spacing.md }}>
            Vehicle
          </AppText>
          <VehicleSummary vehicle={vehicle} />
        </AppCard>
      </View>
    </ScrollView>
  );
}
