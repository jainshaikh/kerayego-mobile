import { useState } from 'react';
import { View } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, router, useLocalSearchParams } from 'expo-router';

import { useAuth } from '../../auth/auth-context';
import { registerSchema, type RegisterFormValues } from '../../schemas/auth.schema';
import { normalizeApiError } from '../../api/errors';
import { AppButton, AppInput, AppScreen, AppText } from '../../components/ui';
import { useTheme } from '../../theme';

export default function RegisterScreen() {
  const { register } = useAuth();
  const { spacing, colors } = useTheme();
  // Not used here directly — registering doesn't log anyone in — just passed
  // on to login, so a guest who signed up mid-action ends up back where they
  // started once they do log in.
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const loginHref = returnTo ? { pathname: '/login' as const, params: { returnTo } } : '/login';
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
  });

  const onSubmit = async (values: RegisterFormValues) => {
    setFormError(null);
    try {
      const result = await register(values);
      setSuccessMessage(result.message);
    } catch (error) {
      setFormError(normalizeApiError(error).message);
    }
  };

  if (successMessage) {
    return (
      <AppScreen contentContainerStyle={{ padding: spacing.lg, justifyContent: 'center', flexGrow: 1 }}>
        <AppText variant="title" style={{ marginBottom: spacing.sm }}>
          Check your email
        </AppText>
        <AppText muted style={{ marginBottom: spacing.xl }}>
          {successMessage}
        </AppText>
        <AppButton title="Go to login" onPress={() => router.replace(loginHref)} />
      </AppScreen>
    );
  }

  return (
    <AppScreen scroll keyboardAvoiding contentContainerStyle={{ padding: spacing.lg, flexGrow: 1 }}>
      <AppText variant="title" style={{ marginBottom: spacing.xs }}>
        Create your account
      </AppText>
      <AppText muted style={{ marginBottom: spacing.xl }}>
        Browse and book vehicles near you.
      </AppText>

      <Controller
        control={control}
        name="name"
        render={({ field }) => (
          <AppInput
            label="Full name"
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
            label="Phone"
            keyboardType="phone-pad"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.phone?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="password"
        render={({ field }) => (
          <AppInput
            label="Password"
            isPassword
            autoCapitalize="none"
            helperText="At least 8 characters, with an uppercase letter, lowercase letter, and number."
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.password?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="confirmPassword"
        render={({ field }) => (
          <AppInput
            label="Confirm password"
            isPassword
            autoCapitalize="none"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.confirmPassword?.message}
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
