import { View } from 'react-native';
import { useTheme } from '../../theme';
import { AppText } from './AppText';

interface RowProps {
  label: string;
  value: string;
}

// Compact caption-sized label/value line for dense read-only detail lists
// (trip/booking/vehicle summary cards).
export function Row({ label, value }: RowProps) {
  const { spacing } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs }}>
      <AppText muted variant="caption">
        {label}
      </AppText>
      <AppText variant="caption">{value}</AppText>
    </View>
  );
}
