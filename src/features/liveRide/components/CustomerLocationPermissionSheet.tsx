import { View } from 'react-native';

import { AppButton, AppSheet, AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';
import type { CustomerLocationPermissionPrompt } from '../backgroundLocation/useCustomerLocationReconcile';
import { shareTargetDisplayLabel } from '../backgroundLocation/customerLocationRules';

interface CustomerLocationPermissionSheetProps {
  prompt: CustomerLocationPermissionPrompt;
}

// The short explanation shown once before the OS location dialog, when a
// carpool seat's or a rental booking's sharing window opens and location
// isn't allowed yet (useCustomerLocationReconcile). "Continue" leads to the
// OS dialog; "Not now", the × and a tap outside all dismiss it — the sharing
// card on the ride/booking screen can bring it back ("Turn on").
export function CustomerLocationPermissionSheet({ prompt }: CustomerLocationPermissionSheetProps) {
  const { spacing } = useTheme();
  const { target, allow, dismiss } = prompt;
  const driver = target?.driverName ?? 'your driver';

  return (
    <AppSheet
      visible={!!target}
      onClose={dismiss}
      title="Share your location with your driver?"
      subtitle={target ? shareTargetDisplayLabel(target) : undefined}
    >
      <AppText>
        So {driver} can find you at pickup, KerayeGo shares where you are until you&apos;re picked up — also while
        your phone is locked or you&apos;re in another app.
      </AppText>
      <AppText muted variant="caption" style={{ marginTop: spacing.sm }}>
        Your phone will ask next: choose &quot;While using the app&quot;. You can stop sharing any time from the ride
        screen. Swiping KerayeGo away from your recent apps also stops it.
      </AppText>
      <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
        <AppButton title="Continue" onPress={allow} />
        <AppButton title="Not now" variant="ghost" onPress={dismiss} />
      </View>
    </AppSheet>
  );
}
