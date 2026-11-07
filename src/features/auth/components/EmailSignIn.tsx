import { useState } from 'react';
import { View } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { authApi } from '../../../api/auth.api';
import { normalizeApiError } from '../../../api/errors';
import { AppButton, AppInput, AppText } from '../../../components/ui';
import { signInEmailSchema, type SignInEmailFormValues } from '../../../schemas/auth.schema';
import { useTheme } from '../../../theme';
import type { AuthUser, User } from '../../../types/api.types';
import { resendAvailableFromNow, resendDelaySeconds } from '../signInCode';
import { CodeEntryStep } from './CodeEntryStep';

interface SentCode {
  email: string;
  message: string;
  resendAt: number;
}

interface EmailSignInProps {
  // Prefilled (e.g. after phone sign-up's 409 EMAIL_TAKEN).
  initialEmail?: string;
  onSignedIn: (user: AuthUser | User) => void;
  // Back to the phone sign-in.
  onUsePhone: () => void;
}

// The "Sign in with email instead" backup (plan A11, A21) — sign-in only:
// email → POST /auth/code/request → the 6-digit code (POST /auth/code/verify).
// No passwords, and no sign-up here (sign-up is by phone).
export function EmailSignIn({ initialEmail, onSignedIn, onUsePhone }: EmailSignInProps) {
  const { spacing, colors } = useTheme();
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState<SentCode | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInEmailFormValues>({
    resolver: zodResolver(signInEmailSchema),
    defaultValues: { email: initialEmail ?? '' },
  });

  const onSubmit = async (values: SignInEmailFormValues) => {
    setFormError(null);
    try {
      const result = await authApi.requestCode(values.email);
      setSent({
        email: values.email,
        message: result.message,
        resendAt: resendAvailableFromNow(resendDelaySeconds(result.resendAfterSeconds)),
      });
    } catch (error) {
      setFormError(normalizeApiError(error).message);
    }
  };

  if (sent) {
    return (
      <CodeEntryStep
        email={sent.email}
        message={sent.message}
        initialResendAt={sent.resendAt}
        onSignedIn={onSignedIn}
        onUseDifferentEmail={() => setSent(null)}
      />
    );
  }

  return (
    <View>
      <AppText variant="title" style={{ marginBottom: spacing.xs }}>
        Sign in with email
      </AppText>
      <AppText muted style={{ marginBottom: spacing.xl }}>
        Enter your account&apos;s email and we&apos;ll send you a 6-digit code to sign in.
      </AppText>

      <Controller
        control={control}
        name="email"
        render={({ field }) => (
          <AppInput
            label="Email"
            placeholder="you@example.com"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.email?.message}
          />
        )}
      />

      {formError ? (
        <AppText color={colors.danger} style={{ marginBottom: spacing.md }}>
          {formError}
        </AppText>
      ) : null}

      <AppButton title="Send code" loading={isSubmitting} onPress={handleSubmit(onSubmit)} />

      <AppButton
        title="Use my mobile number instead"
        variant="ghost"
        onPress={onUsePhone}
        style={{ marginTop: spacing.md }}
      />
    </View>
  );
}
