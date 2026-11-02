import { TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '../../theme';
import { AppText } from './AppText';

interface AppInputProps extends TextInputProps {
  label?: string;
  error?: string;
  helperText?: string;
}

export function AppInput({ label, error, helperText, style, ...props }: AppInputProps) {
  const { colors, radii, spacing, fontSize } = useTheme();

  return (
    <View style={{ marginBottom: spacing.md }}>
      {label ? (
        <AppText variant="label" style={{ marginBottom: spacing.xs }}>
          {label}
        </AppText>
      ) : null}

      <View style={{ position: 'relative', justifyContent: 'center' }}>
        <TextInput
          placeholderTextColor={colors.textFaint}
          style={[
            {
              minHeight: 48,
              borderWidth: 1,
              borderColor: error ? colors.danger : colors.borderStrong,
              borderRadius: radii.md,
              paddingHorizontal: spacing.md,
              color: colors.text,
              backgroundColor: colors.surface,
              fontSize: fontSize.md,
            },
            style,
          ]}
          accessibilityLabel={label}
          {...props}
        />
      </View>

      {error ? (
        <AppText variant="caption" color={colors.danger} style={{ marginTop: spacing.xs }}>
          {error}
        </AppText>
      ) : helperText ? (
        <AppText variant="caption" muted style={{ marginTop: spacing.xs }}>
          {helperText}
        </AppText>
      ) : null}
    </View>
  );
}
