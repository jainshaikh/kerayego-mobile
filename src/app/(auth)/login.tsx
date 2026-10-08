import { useState } from 'react';
import { View } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, router, useLocalSearchParams, type Href } from 'expo-router';

import { useAuth } from '../../auth/auth-context';
import { roleHomePath } from '../../auth/auth-guards';
import { loginSchema, type LoginFormValues } from '../../schemas/auth.schema';
import { normalizeApiError } from '../../api/errors';
import { AppButton, AppInput, AppScreen, AppText } from '../../components/ui';
import { useTheme } from '../../theme';

export default function LoginScreen() {
  const { login } = useAuth();
  const { spacing, colors } = useTheme();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema) });

  const onSubmit = async (values: LoginFormValues) => {
    setFormError(null);
    try {
      const user = await login(values);
      // returnTo comes from a runtime query param (deep link or our own navigation),
      // so it can't be statically checked against the generated route union.
      router.replace(((returnTo as string) || roleHomePath(user.role)) as Href);
    } catch (error) {
      setFormError(normalizeApiError(error).message);
    }
  };

  return (
    <AppScreen scroll keyboardAvoiding contentContainerStyle={{ padding: spacing.lg, justifyContent: 'center', flexGrow: 1 }}>
      <AppText variant="title" style={{ marginBottom: spacing.xs }}>
        Welcome back
      </AppText>
      <AppText muted style={{ marginBottom: spacing.xl }}>
        Log in to manage your bookings and saved vehicles.
      </AppText>

      <Controller
        control={control}
        name="email"
        render={({ field }) => (
          <AppInput
            label="Email"
            placeholder="you@example.com"
            autoCapitalize="none"
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
        name="password"
        render={({ field }) => (
          <AppInput
            label="Password"
            placeholder="••••••••"
            isPassword
            autoCapitalize="none"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.password?.message}
          />
        )}
      />

      {formError ? (
        <AppText color={colors.danger} style={{ marginBottom: spacing.md }}>
          {formError}
        </AppText>
      ) : null}

      <AppButton title="Log in" loading={isSubmitting} onPress={handleSubmit(onSubmit)} />

      <View style={{ alignItems: 'center', marginTop: spacing.lg, gap: spacing.sm }}>
        <Link href="/forgot-password">
          <AppText color={colors.primary}>Forgot password?</AppText>
        </Link>
        <Link href={returnTo ? { pathname: '/register', params: { returnTo } } : '/register'}>
          <AppText muted>
            Don&apos;t have an account? <AppText color={colors.primary}>Sign up</AppText>
          </AppText>
        </Link>
      </View>
    </AppScreen>
  );
}
