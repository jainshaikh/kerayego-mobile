import { useState } from 'react';
import { View } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, router, useLocalSearchParams, type Href } from 'expo-router';

import { authApi } from '../../api/auth.api';
import { roleHomePath } from '../../auth/auth-guards';
import { signInEmailSchema, type SignInEmailFormValues } from '../../schemas/auth.schema';
import { normalizeApiError } from '../../api/errors';
import { CodeEntryStep } from '../../features/auth/components/CodeEntryStep';
import { resendAvailableFromNow, resendDelaySeconds } from '../../features/auth/signInCode';
import { AppButton, AppInput, AppScreen, AppText } from '../../components/ui';
import { useTheme } from '../../theme';
import type { AuthUser, User } from '../../types/api.types';

interface SentCode {
  email: string;
  message: string;
  resendAt: number;
}

// Sign-in by emailed code (plan A11, A21): email → POST /auth/code/request
// → the 6-digit code (POST /auth/code/verify). No passwords.
export default function LoginScreen() {
  const { spacing, colors } = useTheme();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState<SentCode | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInEmailFormValues>({ resolver: zodResolver(signInEmailSchema) });

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

  const onSignedIn = (user: AuthUser | User) => {
    // returnTo comes from a runtime query param (deep link or our own navigation),
    // so it can't be statically checked against the generated route union.
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
          onUseDifferentEmail={() => setSent(null)}
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen scroll keyboardAvoiding contentContainerStyle={{ padding: spacing.lg, justifyContent: 'center', flexGrow: 1 }}>
      <AppText variant="title" style={{ marginBottom: spacing.xs }}>
        Welcome back
      </AppText>
      <AppText muted style={{ marginBottom: spacing.xl }}>
        Enter your email and we&apos;ll send you a 6-digit code to sign in.
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

      <View style={{ alignItems: 'center', marginTop: spacing.lg }}>
        <Link href={returnTo ? { pathname: '/register', params: { returnTo } } : '/register'}>
          <AppText muted>
            Don&apos;t have an account? <AppText color={colors.primary}>Sign up</AppText>
          </AppText>
        </Link>
      </View>
    </AppScreen>
  );
}
