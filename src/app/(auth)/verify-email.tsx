import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

import { authApi } from '../../api/auth.api';
import { normalizeApiError } from '../../api/errors';
import { useAuth } from '../../auth/auth-context';
import { AppButton, AppInput, AppScreen, AppText, LoadingState } from '../../components/ui';
import { useTheme } from '../../theme';

const RESEND_COOLDOWN_SECONDS = 60;

export default function VerifyEmailScreen() {
  const { spacing, colors } = useTheme();
  const { user, isAuthenticated, refreshUser } = useAuth();
  const { token: tokenParam } = useLocalSearchParams<{ token?: string }>();
  const [manualToken, setManualToken] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>(tokenParam ? 'loading' : 'idle');
  const [message, setMessage] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const isUnverified = isAuthenticated && user?.emailVerified === false;

  useEffect(() => {
    if (cooldown === 0) return;
    const timer = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleResend = async () => {
    setResending(true);
    try {
      const result = await authApi.resendVerification();
      setMessage(result.message);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (error) {
      setMessage(normalizeApiError(error).message);
    } finally {
      setResending(false);
    }
  };

  const verify = async (token: string) => {
    setStatus('loading');
    try {
      const result = await authApi.verifyEmail(token);
      // Signed in: read the user back, so the account screens stop sending
      // them here (emailVerified is now true).
      if (isAuthenticated) await refreshUser().catch(() => {});
      setMessage(result.message);
      setStatus('success');
    } catch (error) {
      setMessage(normalizeApiError(error).message);
      setStatus('error');
    }
  };

  useEffect(() => {
    // Deliberately no setState synchronously in the effect body itself — the state
    // updates happen inside verifyOnMount's async continuations after the first
    // `await`, not during this callback's synchronous execution.
    let cancelled = false;

    async function verifyOnMount(token: string) {
      try {
        const result = await authApi.verifyEmail(token);
        if (isAuthenticated) await refreshUser().catch(() => {});
        if (cancelled) return;
        setMessage(result.message);
        setStatus('success');
      } catch (error) {
        if (cancelled) return;
        setMessage(normalizeApiError(error).message);
        setStatus('error');
      }
    }

    if (tokenParam) verifyOnMount(tokenParam);
    return () => {
      cancelled = true;
    };
    // Only for the link's token — not again when the session changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenParam]);

  if (status === 'loading') return <LoadingState label="Verifying your email..." />;

  if (status === 'success') {
    return (
      <AppScreen contentContainerStyle={{ padding: spacing.lg, justifyContent: 'center', flexGrow: 1 }}>
        <AppText variant="title" style={{ marginBottom: spacing.sm }}>
          Email verified
        </AppText>
        <AppText muted style={{ marginBottom: spacing.xl }}>
          {message}
        </AppText>
        {isAuthenticated ? (
          <AppButton title="Continue" onPress={() => router.replace('/')} />
        ) : (
          <AppButton title="Go to login" onPress={() => router.replace('/login')} />
        )}
      </AppScreen>
    );
  }

  return (
    <AppScreen scroll keyboardAvoiding contentContainerStyle={{ padding: spacing.lg, justifyContent: 'center', flexGrow: 1 }}>
      <AppText variant="title" style={{ marginBottom: spacing.xs }}>
        Verify your email
      </AppText>
      <AppText muted style={{ marginBottom: spacing.xl }}>
        {isUnverified && user?.email
          ? `We've sent a verification link to ${user.email}. Click it, or paste the code below.`
          : 'Paste the verification code from your email.'}
      </AppText>

      {isUnverified ? (
        <AppButton
          variant="secondary"
          title={cooldown > 0 ? `Resend available in ${cooldown}s` : 'Resend verification email'}
          onPress={handleResend}
          loading={resending}
          disabled={cooldown > 0}
          style={{ marginBottom: spacing.lg }}
        />
      ) : null}

      <AppInput label="Verification code" autoCapitalize="none" value={manualToken} onChangeText={setManualToken} />

      {message ? (
        <AppText color={status === 'error' ? colors.danger : colors.text} style={{ marginBottom: spacing.md }}>
          {message}
        </AppText>
      ) : null}

      <AppButton title="Verify" onPress={() => verify(manualToken)} disabled={!manualToken} />
    </AppScreen>
  );
}
