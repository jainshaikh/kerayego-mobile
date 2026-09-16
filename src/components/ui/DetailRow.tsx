import { View } from 'react-native';
import { useTheme } from '../../theme';
import { AppText } from './AppText';

interface DetailRowProps {
  label: string;
  value: string;
}

// Body-sized label/value line, value right-aligned and wrapping (never
// truncating) — used inside larger detail-summary cards, e.g. the live-ride
// Details/Summary tabs.
export function DetailRow({ label, value }: DetailRowProps) {
  const { colors, spacing } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
      <AppText muted variant="body">
        {label}
      </AppText>
      <AppText variant="body" color={colors.text} style={{ textAlign: 'right', flexShrink: 1 }}>
        {value}
      </AppText>
    </View>
  );
}
