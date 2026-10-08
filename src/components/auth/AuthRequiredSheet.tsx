import { router } from 'expo-router';

import { AppButton, AppSheet, AppText } from '../ui';
import { useTheme } from '../../theme';

interface AuthRequiredSheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  message: string;
  // Where login (or sign-up, then login) lands the user afterwards —
  // normally the screen this sheet was opened from.
  returnTo: string;
}

// Shown instead of an action that needs an account when nobody is logged in,
// so a guest is asked to sign in up front rather than filling out a form only
// for the backend to reject the submit with a 401.
export function AuthRequiredSheet({ visible, onClose, title, message, returnTo }: AuthRequiredSheetProps) {
  const { spacing } = useTheme();

  const goTo = (pathname: '/login' | '/register') => {
    onClose();
    router.push({ pathname, params: { returnTo } });
  };

  return (
    <AppSheet visible={visible} onClose={onClose} title={title}>
      <AppText muted style={{ marginBottom: spacing.lg }}>
        {message}
      </AppText>

      <AppButton title="Log in" onPress={() => goTo('/login')} />
      <AppButton
        title="Create account"
        variant="secondary"
        onPress={() => goTo('/register')}
        style={{ marginTop: spacing.sm }}
      />
    </AppSheet>
  );
}
