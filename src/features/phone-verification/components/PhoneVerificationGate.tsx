import { useState } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';

import { useAuth } from '../../../auth/auth-context';
import { AppButton, AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';
import type { User } from '../../../types/api.types';
import { needsPhoneVerification, phoneOf } from '../phoneVerification';
import { PhoneVerificationFlow } from './PhoneVerificationFlow';

// The blocking "Verify your mobile number" screen (WhatsApp OTP, 2026-11).
// Rendered once at the root, over whatever screen the person is on, whenever
// the signed-in user's mustVerifyPhone is true — after sign-in, sign-up,
// session restore, and after any 403 PHONE_NOT_VERIFIED (auth-context re-reads
// GET /users/me). The only ways out are verifying or "Sign out": no ×, no
// backdrop, and the Android back button does nothing. Verifying replaces the
// user, which hides it, and the person carries on where they were.
//
// A full-screen Modal (not a route) so it sits above any sheet that was open
// and leaves the navigation underneath untouched.
export function PhoneVerificationGate() {
  const { colors, spacing } = useTheme();
  const { top, bottom } = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { user, isAuthenticated, replaceUser, logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const visible = isAuthenticated && needsPhoneVerification(user);

  const onVerified = (verified: User) => {
    replaceUser(verified);
    // Whatever failed underneath with 403 PHONE_NOT_VERIFIED loads again.
    void queryClient.invalidateQueries();
  };

  const signOut = async () => {
    setSigningOut(true);
    try {
      await logout();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={() => {}}>
      <KeyboardAvoidingView
        behavior="padding"
        style={{ flex: 1, backgroundColor: colors.background, paddingTop: top, paddingBottom: bottom }}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: spacing.lg }}
        >
          <View style={{ alignItems: 'center', marginBottom: spacing.lg }}>
            <Ionicons name="logo-whatsapp" size={44} color={colors.success} />
          </View>
          <AppText variant="title" style={{ marginBottom: spacing.xs, textAlign: 'center' }}>
            Verify your mobile number
          </AppText>
          <AppText muted style={{ marginBottom: spacing.xl, textAlign: 'center' }}>
            We&apos;ll send a 6-digit code to your number on WhatsApp. You need a verified number to use KerayeGo.
          </AppText>

          {visible && user ? (
            <PhoneVerificationFlow key={user.id} initialPhone={phoneOf(user) ?? ''} onVerified={onVerified} />
          ) : null}

          <AppButton
            title="Sign out"
            variant="ghost"
            loading={signingOut}
            onPress={() => void signOut()}
            style={{ marginTop: spacing.lg }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
