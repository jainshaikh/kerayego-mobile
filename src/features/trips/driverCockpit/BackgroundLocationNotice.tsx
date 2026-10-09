import { Linking, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';
import type { DriverBackgroundLocation } from '../../liveRide/backgroundLocation/useDriverBackgroundLocation';

const DETAIL: Record<NonNullable<DriverBackgroundLocation['warning']>, string> = {
  permission: 'Location access is off for KerayeGo.',
  start_failed: "Background location sharing couldn't start.",
  unavailable: "This version of the app can't share your location in the background.",
};

interface BackgroundLocationNoticeProps {
  backgroundLocation: DriverBackgroundLocation;
}

// The cockpit's warning that riders will stop seeing the driver move once
// the driver leaves the app (locks the phone, opens Google Maps): location
// permission is off, or background sharing couldn't start. A full-width strip
// under the ride header, like OfflineQueueNotice's 'bar'. Hidden while
// background sharing works.
export function BackgroundLocationNotice({ backgroundLocation }: BackgroundLocationNoticeProps) {
  const { tones, spacing, radii } = useTheme();
  const { warning, retry } = backgroundLocation;
  if (!warning) return null;

  const action =
    warning === 'permission'
      ? {
          label: 'Open settings',
          onPress: () => {
            Linking.openSettings().catch(() => undefined);
          },
        }
      : warning === 'start_failed'
        ? { label: 'Try again', onPress: retry }
        : null;

  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.sm,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
        backgroundColor: tones.warning.bg,
      }}
    >
      <Ionicons name="location-outline" size={18} color={tones.warning.fg} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <AppText variant="label" color={tones.warning.fg}>
          Location sharing stops when you leave the app — allow location to keep riders updated
        </AppText>
        <AppText variant="caption" color={tones.warning.fg} style={{ marginTop: 2 }}>
          {DETAIL[warning]}
        </AppText>
      </View>
      {action ? (
        <Pressable
          onPress={action.onPress}
          hitSlop={8}
          accessibilityRole="button"
          style={{ paddingHorizontal: spacing.xs, paddingVertical: 2, borderRadius: radii.md }}
        >
          <AppText variant="label" color={tones.warning.fg} style={{ textDecorationLine: 'underline' }}>
            {action.label}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}
