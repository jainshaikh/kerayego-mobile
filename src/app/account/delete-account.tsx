import { useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';

import { useAuth } from '../../auth/auth-context';
import { usersApi } from '../../api/users.api';
import { normalizeApiError } from '../../api/errors';
import {
  DELETION_REASON_MAX_LENGTH,
  deletionScheduledMessage,
  toDeletionRequestPayload,
} from '../../features/account/accountDeletion';
import { AppButton, AppCard, AppInput, AppScreen, AppText } from '../../components/ui';
import { useTheme } from '../../theme';

const DELETED = [
  'Your profile: name, email and phone number',
  'Your saved cars',
  'Your personal cars for trips, with their photos and documents',
  'Your driver details',
];

const KEPT = [
  'Reviews you wrote stay, shown as "Deleted user"',
  'Booking and trip history stays, without your name',
];

// Plan A16, A20, A51 — POST /users/me/delete-request. Deletion happens 72 hours
// after the request; signing in again, or the link in the confirmation email,
// cancels it. The backend refuses (400, with a message saying what) while
// anything is still active, and on success signs the person out everywhere.
export default function DeleteAccountScreen() {
  const { spacing, colors } = useTheme();
  const { endSessionAfterAccountDeletion } = useAuth();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await usersApi.requestAccountDeletion(toDeletionRequestPayload(reason));
      const message = deletionScheduledMessage(result.scheduledFor);
      // Leave the signed-in-only stack before the session goes, so its layout
      // never redirects to the login screen on the way out.
      router.dismissTo('/');
      await endSessionAfterAccountDeletion();
      Alert.alert('Account deletion scheduled', message);
    } catch (err) {
      setError(normalizeApiError(err).message);
      setIsSubmitting(false);
    }
  };

  const confirm = () => {
    Alert.alert(
      'Delete your account?',
      'Your account will be deleted in 72 hours and you will be signed out now. Signing in again before then cancels it.',
      [
        { text: 'Keep my account', style: 'cancel' },
        { text: 'Delete my account', style: 'destructive', onPress: () => void submit() },
      ],
    );
  };

  return (
    <AppScreen scroll keyboardAvoiding contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
      <AppText variant="title">Delete your account</AppText>
      <AppText muted>
        Your account is deleted 72 hours after you ask. Until then you can change your mind: sign in again, or
        use the link in the email we send you.
      </AppText>

      <AppCard style={{ gap: spacing.xs }}>
        <AppText variant="subtitle">What is deleted</AppText>
        <BulletList items={DELETED} />
      </AppCard>

      <AppCard style={{ gap: spacing.xs }}>
        <AppText variant="subtitle">What is kept</AppText>
        <BulletList items={KEPT} />
      </AppCard>

      <AppCard style={{ gap: spacing.xs }}>
        <AppText variant="subtitle">Before you start</AppText>
        <AppText muted>
          Finish or cancel anything that is still active first: rental bookings, trips you posted, and seat
          requests on trips. We will tell you if something is still open.
        </AppText>
      </AppCard>

      <View>
        <AppInput
          label="Why are you leaving? (optional)"
          value={reason}
          onChangeText={setReason}
          maxLength={DELETION_REASON_MAX_LENGTH}
          multiline
          textAlignVertical="top"
          style={{ minHeight: 96, paddingTop: spacing.sm }}
          helperText={`${reason.length}/${DELETION_REASON_MAX_LENGTH}`}
        />
      </View>

      {error ? <AppText color={colors.danger}>{error}</AppText> : null}

      <AppButton title="Delete my account" variant="danger" loading={isSubmitting} onPress={confirm} />
      <AppButton title="Keep my account" variant="secondary" disabled={isSubmitting} onPress={() => router.back()} />
    </AppScreen>
  );
}

function BulletList({ items }: { items: string[] }) {
  const { spacing } = useTheme();
  return (
    <View style={{ gap: spacing.xs }}>
      {items.map((item) => (
        <View key={item} style={{ flexDirection: 'row', gap: spacing.sm }}>
          <AppText muted>•</AppText>
          <AppText muted style={{ flex: 1 }}>
            {item}
          </AppText>
        </View>
      ))}
    </View>
  );
}
