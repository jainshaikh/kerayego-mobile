import { AppSheet } from '../../../components/ui';
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
 * tab. Wraps the existing ChatPanel (untouched internally) in the standard
 * AppSheet chrome — rider name/route header, × close and tap-outside-to-close
 * — as a full-bleed (`flush`) sheet fixed at 76% of screen height.
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
  return (
    <AppSheet
      visible={visible}
      onClose={onClose}
      title={riderName}
      subtitle={`${pickupLabel} → ${dropoffLabel}`}
      height="76%"
      flush
    >
      <ChatPanel active={visible} tripInquiryId={tripInquiryId} otherPartyName={riderName} />
    </AppSheet>
  );
}
