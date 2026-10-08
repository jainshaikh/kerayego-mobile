import type { ReactElement } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type RefreshControlProps,
  type ViewProps,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';

interface AppScreenProps extends ViewProps {
  scroll?: boolean;
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

  const content = scroll ? (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.scrollContent, contentContainerStyle]}
      refreshControl={refreshControl}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, contentContainerStyle]}>{children}</View>
  );

  const body = keyboardAvoiding ? (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      {content}
    </KeyboardAvoidingView>
  ) : (
    content
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
