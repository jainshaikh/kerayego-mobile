import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';

interface IdentityHoldBannerProps {
  // useIdentityHold().notice — renders nothing when null.
  message: string | null;
  style?: StyleProp<ViewStyle>;
}

// "Your account is being checked" — shown on the account tab and wherever
// the person books, posts a trip or requests a seat while the account is on
// hold, or when one of those actions was just refused for it.
export function IdentityHoldBanner({ message, style }: IdentityHoldBannerProps) {
  const { tones, spacing, radii } = useTheme();
  if (!message) return null;

  return (
    <View
      accessibilityRole="alert"
      style={[
        {
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: spacing.sm,
          padding: spacing.md,
          borderRadius: radii.md,
          backgroundColor: tones.warning.bg,
          marginBottom: spacing.md,
        },
        style,
      ]}
    >
      <Ionicons name="shield-checkmark-outline" size={18} color={tones.warning.fg} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <AppText variant="label" color={tones.warning.fg}>
          Account check in progress
        </AppText>
        <AppText variant="caption" color={tones.warning.fg} style={{ marginTop: 2 }}>
          {message}
        </AppText>
      </View>
    </View>
  );
}
