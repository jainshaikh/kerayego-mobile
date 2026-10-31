import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AppButton, AppCard, AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';

interface RatePromptCardProps {
  title: string;
  body: string;
  onRate: () => void;
  style?: StyleProp<ViewStyle>;
}

// The end-of-ride "rate now" card a summary keeps while its ride is still
// unrated — the way back into the RateSheet after it was closed.
export function RatePromptCard({ title, body, onRate, style }: RatePromptCardProps) {
  const { colors, spacing } = useTheme();
  return (
    <AppCard style={[{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderColor: colors.primary }, style]}>
      <Ionicons name="star" size={24} color={colors.primary} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <AppText variant="label">{title}</AppText>
        <AppText muted variant="caption">
          {body}
        </AppText>
      </View>
      <AppButton title="Rate" variant="secondary" fullWidth={false} onPress={onRate} />
    </AppCard>
  );
}
