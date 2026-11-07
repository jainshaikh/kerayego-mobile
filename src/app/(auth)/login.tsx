import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';

import { roleHomePath } from '../../auth/auth-guards';
import { EmailSignIn } from '../../features/auth/components/EmailSignIn';
import { PhoneSignInFlow } from '../../features/auth/components/PhoneSignInFlow';
import { AppScreen } from '../../components/ui';
import { useTheme } from '../../theme';
import type { AuthUser, User } from '../../types/api.types';

// Phone-first sign-in (2026-11-06): number → WhatsApp code → signed in, or —
// a number with no account — the profile step, which creates it. Sign-up
// (register.tsx) is the same flow. `?method=email` is the "Sign in with email
// instead" backup: the emailed code (POST /auth/code/request + /code/verify),
// pushed as its own screen so Back returns to the phone sign-in.
export default function LoginScreen() {
  const { spacing } = useTheme();
  const { returnTo, method, email } = useLocalSearchParams<{ returnTo?: string; method?: string; email?: string }>();

  const onSignedIn = (user: AuthUser | User) => {
    // returnTo comes from a runtime query param (deep link or our own navigation),
    // so it can't be statically checked against the generated route union.
    router.replace(((returnTo as string) || roleHomePath(user.role)) as Href);
  };

  const openEmailSignIn = (prefill?: string) => {
    router.push({
      pathname: '/login',
      params: { method: 'email', ...(returnTo ? { returnTo } : {}), ...(prefill ? { email: prefill } : {}) },
    });
  };

  const backToPhone = () => {
    if (router.canGoBack()) router.back();
    else router.replace(returnTo ? { pathname: '/login', params: { returnTo } } : '/login');
  };

  return (
    <AppScreen scroll keyboardAvoiding contentContainerStyle={{ padding: spacing.lg, justifyContent: 'center', flexGrow: 1 }}>
      {method === 'email' ? (
        <>
          <Stack.Screen options={{ title: 'Sign in with email' }} />
          <EmailSignIn initialEmail={email} onSignedIn={onSignedIn} onUsePhone={backToPhone} />
        </>
      ) : (
        <PhoneSignInFlow title="Welcome" onSignedIn={onSignedIn} onEmailSignIn={openEmailSignIn} />
      )}
    </AppScreen>
  );
}
