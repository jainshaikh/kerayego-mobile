import { Modal, Pressable, View } from 'react-native';

import { AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';
import { ChatPanel } from './ChatPanel';

interface ChatModalSheetProps {
  visible: boolean;
  onClose: () => void;
  tripInquiryId: string;
  riderName: string;
  pickupLabel: string;
  dropoffLabel: string;
}

/**
 * Per-rider chat, presented as a modal bottom sheet (design spec §5) — the
 * driver's active-ride screen reintroduces this pattern instead of a Chat
 * tab. Wraps the existing ChatPanel (untouched internally) with the sheet's
 * own chrome: a title/subtitle header + close affordance, 40% black scrim,
 * page-coloured panel, 20px top corners, capped to 76% of screen height.
 *
 * `active` is passed straight through as `visible` — ChatPanel only runs its
 * fetch/join/socket effects while `active` is true, so this sheet being
 * closed (or never having been opened) never joins a chat room or fetches
 * history for nothing.
 */
export function ChatModalSheet({
  visible,
  onClose,
  tripInquiryId,
  riderName,
  pickupLabel,
  dropoffLabel,
}: ChatModalSheetProps) {
  const { colors, spacing } = useTheme();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
        <View
          style={{
            backgroundColor: colors.background,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            height: '76%',
            overflow: 'hidden',
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
              paddingBottom: spacing.sm,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <AppText variant="subtitle" numberOfLines={1}>
                {riderName}
              </AppText>
              <AppText muted variant="caption" numberOfLines={1} style={{ marginTop: 2 }}>
                {pickupLabel} → {dropoffLabel}
              </AppText>
            </View>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close chat">
              <AppText variant="subtitle" color={colors.textMuted}>
                ×
              </AppText>
            </Pressable>
          </View>

          <View style={{ flex: 1 }}>
            <ChatPanel active={visible} tripInquiryId={tripInquiryId} otherPartyName={riderName} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
