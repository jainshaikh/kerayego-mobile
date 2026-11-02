import { useState } from 'react';
import { Switch, View } from 'react-native';

import { normalizeApiError } from '../../../api/errors';
import { AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';
import type { User } from '../../../types/api.types';
import { WHATSAPP_TOGGLE_LABEL, whatsappToggleState } from '../phoneVerification';
import { useWhatsappUpdatesToggle } from '../queries';

// "WhatsApp updates" — booking and trip notifications on WhatsApp (on by
// default; the verification code itself always goes out). PATCH /users/me
// { whatsappUpdates }, optimistic with rollback (queries.ts). Off-limits until
// the number is verified.
export function WhatsAppUpdatesToggle({ user }: { user: User | undefined }) {
  const { colors, spacing } = useTheme();
  const toggle = useWhatsappUpdatesToggle();
  const [error, setError] = useState<string | null>(null);
  const state = whatsappToggleState(user);

  const onValueChange = (next: boolean) => {
    setError(null);
    toggle.mutate(next, {
      onError: (err) => setError(normalizeApiError(err).message),
    });
  };

  return (
    <View style={{ marginBottom: spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText variant="label">{WHATSAPP_TOGGLE_LABEL}</AppText>
          <AppText variant="caption" muted style={{ marginTop: 2 }}>
            {state.helper}
          </AppText>
        </View>
        <Switch
          value={state.value}
          disabled={state.disabled || toggle.isPending}
          onValueChange={onValueChange}
          trackColor={{ true: colors.primary, false: colors.borderStrong }}
          accessibilityLabel={WHATSAPP_TOGGLE_LABEL}
        />
      </View>
      {error ? (
        <AppText variant="caption" color={colors.danger} style={{ marginTop: spacing.xs }}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
}
