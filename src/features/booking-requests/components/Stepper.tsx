import { Pressable, View } from 'react-native';

import { AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';

interface StepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  // A short word after the number: "days", "passengers".
  unit?: string;
  hint?: string;
  error?: string;
}

// − value + for a small whole number (a count, passengers, hours a day).
export function Stepper({ label, value, min, max, onChange, unit, hint, error }: StepperProps) {
  const { colors, spacing, radii } = useTheme();
  const step = (delta: number) => onChange(Math.min(max, Math.max(min, value + delta)));

  const button = (symbol: string, delta: number, disabled: boolean, a11y: string) => (
    <Pressable
      onPress={() => step(delta)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled }}
      hitSlop={4}
      style={{
        width: 40,
        height: 40,
        borderRadius: radii.md,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <AppText variant="title">{symbol}</AppText>
    </Pressable>
  );

  return (
    <View style={{ marginBottom: spacing.md }}>
      <AppText variant="label" style={{ marginBottom: spacing.xs }}>
        {label}
      </AppText>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
        {button('−', -1, value <= min, `Fewer ${label.toLowerCase()}`)}
        <AppText variant="subtitle" accessibilityLiveRegion="polite">
          {value}
          {unit ? <AppText muted> {unit}</AppText> : null}
        </AppText>
        {button('+', 1, value >= max, `More ${label.toLowerCase()}`)}
      </View>
      {error ? (
        <AppText variant="caption" color={colors.danger} style={{ marginTop: spacing.xs }}>
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption" muted style={{ marginTop: spacing.xs }}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}
