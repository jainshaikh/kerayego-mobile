import { Linking, View } from 'react-native';
import { AppButton } from '../../../components/ui';
import { useTheme } from '../../../theme';
import { whatsappUrl } from './tripDisplay';

interface DriverContactActionsProps {
  // driverCallNumber(trip); null hides Call.
  callNumber: string | null;
  // The listing's WhatsApp number (trip.contactNumber); omitted/null hides WhatsApp.
  whatsappNumber?: string | null;
  // In-app chat — passed only where chat is offered (while the trip runs).
  onOpenChat?: () => void;
}

// One row of ways to reach the driver, shared by every rider view that
// offers them (pre-trip card, live Driver tab, ride outcome cards). Renders
// nothing when there's no way at all.
export function DriverContactActions({ callNumber, whatsappNumber, onOpenChat }: DriverContactActionsProps) {
  const { spacing } = useTheme();
  const waUrl = whatsappUrl(whatsappNumber);
  if (!callNumber && !waUrl && !onOpenChat) return null;

  return (
    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
      {onOpenChat ? (
        <View style={{ flex: 1 }}>
          <AppButton title="Chat" onPress={onOpenChat} />
        </View>
      ) : null}
      {callNumber ? (
        <View style={{ flex: 1 }}>
          <AppButton
            title="Call"
            variant="outline"
            onPress={() => Linking.openURL(`tel:${callNumber.replace(/[^\d+]/g, '')}`).catch(() => {})}
          />
        </View>
      ) : null}
      {waUrl ? (
        <View style={{ flex: 1 }}>
          <AppButton title="WhatsApp" variant="secondary" onPress={() => Linking.openURL(waUrl).catch(() => {})} />
        </View>
      ) : null}
    </View>
  );
}
