import type { ReactNode } from 'react';
import { Keyboard, Modal, Pressable, StyleSheet, View, type DimensionValue } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../../theme';
import { AppText } from './AppText';

interface AppSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  // One muted line under the title (e.g. the vehicle or route a form is for).
  subtitle?: string;
  // Fixed height for sheets whose content fills the space (a map, a chat);
  // otherwise the sheet sizes to its content, capped at 90% of the screen.
  height?: DimensionValue;
  // Full-bleed body (no padding) under a divided header — for content that
  // manages its own padding, like ChatPanel.
  flush?: boolean;
  children: ReactNode;
}

// The app's standard bottom sheet. Every sheet/modal must be dismissable
// three ways — the × button in the top-right corner, a tap anywhere on the
// dimmed backdrop outside the sheet, and the Android back button — so build
// new sheets on this instead of a raw <Modal>.
export function AppSheet({ visible, onClose, title, subtitle, height, flush = false, children }: AppSheetProps) {
  const { colors, radii, spacing } = useTheme();
  // Keeps a padded sheet's bottom buttons clear of the Android gesture bar /
  // iOS home indicator (the sheet is drawn edge-to-edge at the screen bottom).
  const { bottom: bottomInset } = useSafeAreaInsets();

  // With the keyboard up, a tap outside usually means "put the keyboard
  // away", not "throw away this form" — so that first tap only dismisses it.
  const handleBackdropPress = () => {
    if (Keyboard.isVisible()) {
      Keyboard.dismiss();
      return;
    }
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
        {/* A sibling behind the sheet, not its parent — so taps on the sheet
            itself never reach it, only taps on the visible backdrop do. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={handleBackdropPress} accessibilityLabel="Close" />
        <View
          style={{
            backgroundColor: colors.background,
            borderTopLeftRadius: radii.sheet,
            borderTopRightRadius: radii.sheet,
            overflow: 'hidden',
            ...(height !== undefined ? { height } : { maxHeight: '90%' }),
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: spacing.md,
              paddingHorizontal: spacing.lg,
              paddingTop: spacing.lg,
              paddingBottom: flush ? spacing.sm : spacing.md,
              ...(flush ? { borderBottomWidth: 1, borderBottomColor: colors.border } : null),
            }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              {title ? <AppText variant="subtitle">{title}</AppText> : null}
              {subtitle ? (
                <AppText muted variant="caption" numberOfLines={1} style={{ marginTop: 2 }}>
                  {subtitle}
                </AppText>
              ) : null}
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={{
                width: 32,
                height: 32,
                borderRadius: radii.full,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.surfaceAlt,
              }}
            >
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>

          <View
            style={{
              flexShrink: 1,
              ...(height !== undefined ? { flex: 1 } : null),
              ...(flush ? null : { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg + bottomInset }),
            }}
          >
            {children}
          </View>
        </View>
      </View>
    </Modal>
  );
}
