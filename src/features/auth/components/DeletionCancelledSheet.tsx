import { useAuth } from '../../../auth/auth-context';
import { AppButton, AppSheet, AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';
import { DELETION_CANCELLED_MESSAGE } from '../signInCode';

// Shown once after a sign-in that cancelled a pending account deletion
// (POST /auth/code/verify → deletionCancelled: true, plan A51). Rendered at
// the root so it shows on whatever screen the sign-in lands on.
export function DeletionCancelledSheet() {
  const { spacing } = useTheme();
  const { deletionCancelledNotice, dismissDeletionCancelledNotice } = useAuth();

  return (
    <AppSheet visible={deletionCancelledNotice} onClose={dismissDeletionCancelledNotice} title="Account kept">
      <AppText muted style={{ marginBottom: spacing.lg }}>
        {DELETION_CANCELLED_MESSAGE}
      </AppText>
      <AppButton title="OK" onPress={dismissDeletionCancelledNotice} />
    </AppSheet>
  );
}
