import { View } from 'react-native';
import { AppButton, AppText } from '../ui';
import { useTheme } from '../../theme';

interface NearMeControlProps {
  active: boolean;
  loading: boolean;
  error: string | null;
  onActivate: () => void;
  onClear: () => void;
}

// A single toggle button: tapping it while inactive requests location and
// activates the filter, tapping it again while active clears it. The active
// state is communicated by the button's own fill (primary vs outline) rather
// than a separate status bar or Clear button.
export function NearMeControl({ active, loading, error, onActivate, onClear }: NearMeControlProps) {
  const { colors, spacing } = useTheme();

  return (
    <View>
      <AppButton
        title={loading ? 'Locating…' : '📍 Near me'}
        variant={active ? 'primary' : 'outline'}
        fullWidth={false}
        loading={loading}
        onPress={active ? onClear : onActivate}
      />
      {error ? (
        <AppText variant="caption" color={colors.danger} style={{ marginTop: spacing.xs }}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
}
