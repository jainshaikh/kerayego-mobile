import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '../../auth/auth-context';
import { usersApi } from '../../api/users.api';
import { normalizeApiError } from '../../api/errors';
import { updateProfileSchema, type UpdateProfileFormValues } from '../../schemas/profile.schema';
import { formatPhoneForDisplay } from '../../features/phone-verification/phoneVerification';
import { ChangePhoneSheet } from '../../features/phone-verification/components/ChangePhoneSheet';
import { WhatsAppUpdatesToggle } from '../../features/phone-verification/components/WhatsAppUpdatesToggle';
import { AppButton, AppInput, AppScreen, AppText, LoadingState, StatusBadge } from '../../components/ui';
import { useTheme } from '../../theme';

export default function EditProfileScreen() {
  const { logout } = useAuth();
  const { spacing, colors, tones } = useTheme();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [phoneSheet, setPhoneSheet] = useState<'verify' | 'change' | null>(null);

  const { data: me, isLoading } = useQuery({ queryKey: ['me'], queryFn: () => usersApi.getMe() });

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<UpdateProfileFormValues>({
    resolver: zodResolver(updateProfileSchema),
    values: me ? { name: me.name } : undefined,
  });

  if (isLoading) return <LoadingState label="Loading profile..." />;

  const onSubmit = async (values: UpdateProfileFormValues) => {
    setFormError(null);
    setSavedMessage(null);
    try {
      await usersApi.updateMe({ name: values.name });
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      setSavedMessage('Profile updated.');
    } catch (error) {
      setFormError(normalizeApiError(error).message);
    }
  };

  const phone = me?.phone ?? null;
  const phoneVerified = me?.phoneVerified === true;

  return (
    <AppScreen scroll keyboardAvoiding contentContainerStyle={{ padding: spacing.lg }}>
      <AppText variant="title" style={{ marginBottom: spacing.lg }}>
        Profile & settings
      </AppText>

      <AppInput label="Email" value={me?.email} editable={false} />

      <Controller
        control={control}
        name="name"
        render={({ field }) => (
          <AppInput
            label="Name"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.name?.message}
          />
        )}
      />

      {/* The mobile number changes only through WhatsApp verification. */}
      <View style={{ marginBottom: spacing.md }}>
        <AppText variant="label" style={{ marginBottom: spacing.xs }}>
          Mobile number
        </AppText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
          <AppText muted={!phone}>{phone ? formatPhoneForDisplay(phone) : 'Not added'}</AppText>
          {phoneVerified ? (
            <StatusBadge label="Verified" tone="success" />
          ) : phone ? (
            <Pressable onPress={() => setPhoneSheet('verify')} accessibilityRole="button" hitSlop={8}>
              <AppText variant="caption" color={tones.warning.fg}>
                Not verified · <AppText variant="caption" color={colors.primary}>Verify</AppText>
              </AppText>
            </Pressable>
          ) : null}
        </View>
        <AppButton
          title={phone ? 'Change number' : 'Add number'}
          variant="outline"
          onPress={() => setPhoneSheet('change')}
          style={{ marginTop: spacing.sm }}
        />
      </View>

      {formError ? (
        <AppText color={colors.danger} style={{ marginBottom: spacing.md }}>
          {formError}
        </AppText>
      ) : null}
      {savedMessage ? (
        <AppText color={colors.success} style={{ marginBottom: spacing.md }}>
          {savedMessage}
        </AppText>
      ) : null}

      <AppButton title="Save changes" loading={isSubmitting} onPress={handleSubmit(onSubmit)} />

      <AppText variant="subtitle" style={{ marginTop: spacing.xl, marginBottom: spacing.md }}>
        Settings
      </AppText>
      <WhatsAppUpdatesToggle user={me} />

      <AppButton title="Log out" variant="secondary" onPress={logout} style={{ marginTop: spacing.md }} />

      <ChangePhoneSheet
        visible={phoneSheet !== null}
        initialPhone={phoneSheet === 'verify' ? (phone ?? '') : ''}
        verifyCurrent={phoneSheet === 'verify'}
        onClose={() => setPhoneSheet(null)}
        onVerified={() => {
          setPhoneSheet(null);
          setFormError(null);
          setSavedMessage('Mobile number verified.');
        }}
      />
    </AppScreen>
  );
}
