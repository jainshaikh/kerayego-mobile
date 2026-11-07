import { router, useLocalSearchParams, type Href } from 'expo-router';

import { roleHomePath } from '../../auth/auth-guards';
import { PhoneSignInFlow } from '../../features/auth/components/PhoneSignInFlow';
import { AppScreen } from '../../components/ui';
import { useTheme } from '../../theme';
import type { AuthUser, User } from '../../types/api.types';

// "Create account" starts the same phone flow as login (2026-11-06): number →
// WhatsApp code → the profile step (name, email; role USER) for a new number,
// or straight in for a number that already has an account — the backend
// decides. There is no email sign-up any more; "Sign in with email instead"
// opens login's email backup.
export default function RegisterScreen() {
  const { spacing } = useTheme();
  // Where the guest was heading when asked to sign up — they land there once
  // signed in.
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();

  const onSignedIn = (user: AuthUser | User) => {
    router.replace(((returnTo as string) || roleHomePath(user.role)) as Href);
  };

  const openEmailSignIn = (prefill?: string) => {
    router.push({
      pathname: '/login',
      params: { method: 'email', ...(returnTo ? { returnTo } : {}), ...(prefill ? { email: prefill } : {}) },
    });
  };

  return (
    <AppScreen scroll keyboardAvoiding contentContainerStyle={{ padding: spacing.lg, justifyContent: 'center', flexGrow: 1 }}>
      <PhoneSignInFlow title="Create your account" onSignedIn={onSignedIn} onEmailSignIn={openEmailSignIn} />
    </AppScreen>
  );
}
