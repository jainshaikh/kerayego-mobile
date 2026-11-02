import { useRef, useState } from 'react';
import { View } from 'react-native';

import { authApi } from '../../../api/auth.api';
import { normalizeApiError } from '../../../api/errors';
import { useAuth } from '../../../auth/auth-context';
import { AppButton, AppInput, AppText } from '../../../components/ui';
import { useNow } from '../../../hooks/useNow';
import { useTheme } from '../../../theme';
import type { AuthUser, User } from '../../../types/api.types';
import {
  SIGN_IN_CODE_LENGTH,
  isCompleteCode,
  normalizeCodeInput,
  resendAvailableFromNow,
  resendDelaySeconds,
  resendLabel,
  resendSecondsLeft,
} from '../signInCode';

interface CodeEntryStepProps {
  email: string;
  // What the server said when the code was sent.
  message: string;
  // When "Send again" first works (ms) — worked out by whoever sent the code.
  initialResendAt: number;
  onSignedIn: (user: AuthUser | User) => void;
  onUseDifferentEmail: () => void;
}

// The 6-digit code step shared by the login and sign-up screens:
// POST /auth/code/verify (sends itself once 6 digits are in), "Send again"
// (POST /auth/code/request) after the server's countdown, and a way back to
// change the email.
export function CodeEntryStep({ email, message, initialResendAt, onSignedIn, onUseDifferentEmail }: CodeEntryStepProps) {
  const { spacing } = useTheme();
  const { signInWithCode } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState(message);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendAt, setResendAt] = useState(initialResendAt);
  // Blocks a second verify while one is in flight (auto-submit + a tap).
  const inFlight = useRef(false);

  const now = useNow(true);
  const secondsLeft = resendSecondsLeft(resendAt, now);

  const submit = async (value: string) => {
    if (inFlight.current) return;
    if (!isCompleteCode(value)) {
      setError(`Enter the ${SIGN_IN_CODE_LENGTH}-digit code.`);
      return;
    }
    inFlight.current = true;
    setError(null);
    setSubmitting(true);
    try {
      const user = await signInWithCode({ email, code: value });
      onSignedIn(user);
    } catch (err) {
      setError(normalizeApiError(err).message);
      setSubmitting(false);
    } finally {
      inFlight.current = false;
    }
  };

  const onChangeCode = (raw: string) => {
    const next = normalizeCodeInput(raw);
    setCode(next);
    if (error) setError(null);
    if (isCompleteCode(next) && !isCompleteCode(code)) void submit(next);
  };

  const resend = async () => {
    setError(null);
    setResending(true);
    try {
      const result = await authApi.requestCode(email);
      setResendAt(resendAvailableFromNow(resendDelaySeconds(result.resendAfterSeconds)));
      setInfo(result.message);
      setCode('');
    } catch (err) {
      setError(normalizeApiError(err).message);
    } finally {
      setResending(false);
    }
  };

  return (
    <View>
      <AppText variant="title" style={{ marginBottom: spacing.xs }}>
        Enter your code
      </AppText>
      <AppText muted style={{ marginBottom: spacing.xs }}>
        {info}
      </AppText>
      <AppText style={{ marginBottom: spacing.xl }}>{email}</AppText>

      <AppInput
        label="6-digit code"
        placeholder="123456"
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        autoFocus
        value={code}
        onChangeText={onChangeCode}
        error={error ?? undefined}
        helperText="The code works for 10 minutes."
      />

      <AppButton title="Sign in" loading={submitting} onPress={() => void submit(code)} />

      <AppButton
        title={resendLabel(secondsLeft)}
        variant="secondary"
        loading={resending}
        disabled={secondsLeft > 0 || submitting}
        onPress={() => void resend()}
        style={{ marginTop: spacing.md }}
      />
      <AppButton
        title="Use a different email"
        variant="ghost"
        disabled={submitting}
        onPress={onUseDifferentEmail}
        style={{ marginTop: spacing.sm }}
      />
      <AppText variant="caption" muted style={{ marginTop: spacing.md, textAlign: 'center' }}>
        No code? Check your spam folder.
      </AppText>
    </View>
  );
}
