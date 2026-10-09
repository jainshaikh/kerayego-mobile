import { useState } from 'react';
import { AppButton, AppSheet, AppText } from '../../components/ui';
import { useTheme } from '../../theme';

interface ChatLinkUnavailableSheetProps {
  // Null while closed.
  notice: string | null;
  onClose: () => void;
}

// Shown when a tapped chat notification lands on a screen that can't open
// that chat right now (e.g. before the trip starts) — so the tap visibly
// answers instead of silently dropping the chat.
export function ChatLinkUnavailableSheet({ notice, onClose }: ChatLinkUnavailableSheetProps) {
  const { spacing } = useTheme();
  // Keeps the last message while the sheet slides away, so it doesn't go
  // blank on its way out.
  const [shownNotice, setShownNotice] = useState(notice);
  if (notice !== null && notice !== shownNotice) setShownNotice(notice);

  return (
    <AppSheet visible={notice !== null} onClose={onClose} title="Chat isn't open">
      <AppText muted style={{ marginBottom: spacing.lg }}>
        {shownNotice}
      </AppText>
      <AppButton title="OK" variant="secondary" onPress={onClose} />
    </AppSheet>
  );
}
