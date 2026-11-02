import { useState } from 'react';
import { View } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, router, useLocalSearchParams, type Href } from 'expo-router';

import { useAuth } from '../../auth/auth-context';
import { roleHomePath } from '../../auth/auth-guards';
import { registerSchema, type RegisterFormValues } from '../../schemas/auth.schema';
import { normalizeApiError } from '../../api/errors';
import { CodeEntryStep } from '../../features/auth/components/CodeEntryStep';
import {
  DEFAULT_RESEND_AFTER_SECONDS,
  PHONE_HINT,
  resendAvailableFromNow,
  signUpErrorField,
} from '../../features/auth/signInCode';
import { AppButton, AppInput, AppScreen, AppText } from '../../components/ui';
import { useTheme } from '../../theme';
import type { AuthUser, User } from '../../types/api.types';

interface SentCode {
  email: string;
  message: string;
  resendAt: number;
}

// Sign-up by emailed code (plan A11, A21, A23): name, email and mobile number
// → POST /auth/register (no password; the backend emails a code) → the same
// 6-digit code step as login, which signs the new account in.
export default function RegisterScreen() {
  const { register } = useAuth();
  const { spacing, colors } = useTheme();
  // Where the guest was heading when asked to sign up — they land there once
  // the code signs them in.
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const loginHref = returnTo ? { pathname: '/login' as const, params: { returnTo } } : '/login';
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState<SentCode | null>(null);

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
  });

  const onSubmit = async (values: RegisterFormValues) => {
    setFormError(null);
    try {
      const result = await register(values);
      setSent({
        email: values.email,
        message: result.message,
        // Register has no resendAfterSeconds — the code request's 60 s.
        resendAt: resendAvailableFromNow(DEFAULT_RESEND_AFTER_SECONDS),
      });
    } catch (error) {
      // The server's own message (PHONE_TAKEN, invalid number, email already
      // used), under the field it's about.
      const normalized = normalizeApiError(error);
      const field = signUpErrorField(normalized);
      if (field === 'form') setFormError(normalized.message);
      else setError(field, { type: 'server', message: normalized.message });
    }
  };

  const onSignedIn = (user: AuthUser | User) => {
    router.replace(((returnTo as string) || roleHomePath(user.role)) as Href);
  };

  if (sent) {
    return (
      <AppScreen scroll keyboardAvoiding contentContainerStyle={{ padding: spacing.lg, justifyContent: 'center', flexGrow: 1 }}>
        <CodeEntryStep
          email={sent.email}
          message={sent.message}
          initialResendAt={sent.resendAt}
          onSignedIn={onSignedIn}
          onUseDifferentEmail={() => router.replace(loginHref)}
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen scroll keyboardAvoiding contentContainerStyle={{ padding: spacing.lg, flexGrow: 1 }}>
      <AppText variant="title" style={{ marginBottom: spacing.xs }}>
        Create your account
      </AppText>
      <AppText muted style={{ marginBottom: spacing.xl }}>
        We&apos;ll email you a 6-digit code to sign in. No password needed.
      </AppText>

      <Controller
        control={control}
        name="name"
        render={({ field }) => (
          <AppInput
            label="Full name"
            autoComplete="name"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.name?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="email"
        render={({ field }) => (
          <AppInput
            label="Email"
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
      <Controller
        control={control}
        name="phone"
        render={({ field }) => (
          <AppInput
            label="Mobile number"
            placeholder="03001234567"
            keyboardType="phone-pad"
            autoComplete="tel"
            helperText={PHONE_HINT}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.phone?.message}
          />
        )}
      />

      {formError ? (
        <AppText color={colors.danger} style={{ marginBottom: spacing.md }}>
          {formError}
        </AppText>
      ) : null}

      <AppButton title="Create account" loading={isSubmitting} onPress={handleSubmit(onSubmit)} />

      <View style={{ alignItems: 'center', marginTop: spacing.lg }}>
        <Link href={loginHref}>
          <AppText muted>
            Already have an account? <AppText color={colors.primary}>Log in</AppText>
          </AppText>
        </Link>
      </View>
    </AppScreen>
  );
}
