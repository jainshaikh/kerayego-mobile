import type { ReactElement } from 'react';
import { ScrollView, StyleSheet, View, type RefreshControlProps, type ViewProps } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { FormScrollView } from './FormScrollView';

interface AppScreenProps extends ViewProps {
  scroll?: boolean;
  // For screens with text inputs: a scroll screen scrolls the focused input
  // above the keyboard (FormScrollView); a fixed one shrinks to clear it.
  keyboardAvoiding?: boolean;
  edges?: Edge[];
  contentContainerStyle?: object;
  // Only applies with `scroll` — a non-scroll screen has nothing to pull.
  refreshControl?: ReactElement<RefreshControlProps>;
}

export function AppScreen({
  children,
  scroll = false,
  keyboardAvoiding = false,
  edges = ['top', 'left', 'right', 'bottom'],
  style,
  contentContainerStyle,
  refreshControl,
  ...props
}: AppScreenProps) {
  const { colors } = useTheme();

  const body = scroll ? (
    keyboardAvoiding ? (
      <FormScrollView
        contentContainerStyle={[styles.scrollContent, contentContainerStyle]}
        refreshControl={refreshControl}
      >
        {children}
      </FormScrollView>
    ) : (
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scrollContent, contentContainerStyle]}
        refreshControl={refreshControl}
      >
        {children}
      </ScrollView>
    )
  ) : keyboardAvoiding ? (
    <KeyboardAvoidingView behavior="padding" automaticOffset style={[styles.flex, contentContainerStyle]}>
      {children}
    </KeyboardAvoidingView>
  ) : (
    <View style={[styles.flex, contentContainerStyle]}>{children}</View>
  );

  return (
    <SafeAreaView edges={edges} style={[styles.flex, { backgroundColor: colors.background }, style]} {...props}>
      {body}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, padding: 16 },
});
