import { useRef, useState } from 'react';
import { View } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { usersApi } from '../../../api/users.api';
import { normalizeApiError } from '../../../api/errors';
import { AppButton, AppInput, AppText } from '../../../components/ui';
import { useNow } from '../../../hooks/useNow';
import { sendPhoneCodeSchema, type SendPhoneCodeFormValues } from '../../../schemas/profile.schema';
import { useTheme } from '../../../theme';
import type { User } from '../../../types/api.types';
import {
  SIGN_IN_CODE_LENGTH,
  isCompleteCode,
  normalizeCodeInput,
  resendLabel,
  resendSecondsLeft,
} from '../../auth/signInCode';
import {
  PHONE_VERIFY_HINT,
  WHATSAPP_UPDATES_SMALL_PRINT,
  formatPhoneForDisplay,
  mustMessageForCode,
  phoneVerificationErrorMessage,
  sendCodeErrorNow,
  sendCodeErrorText,
  sentVerificationCodeNow,
  verificationCodeIntro,
  type SendCodeError,
  type SentVerificationCode,
} from '../phoneVerification';
import { GetCodeOnWhatsApp } from './GetCodeOnWhatsApp';

interface PhoneVerificationFlowProps {
  // Prefilled into step 1 (the account's current number, if any).
  initialPhone: string;
  // The server's updated user, once the number is verified (or was already).
  onVerified: (user: User) => void;
}

// The two-step WhatsApp verification shared by the blocking "Verify your
// mobile number" screen and the profile's "Change number" sheet:
// 1. the number → POST /users/me/phone/send-code;
// 2. the 6-digit code → POST /users/me/phone/verify (sends itself once 6
//    digits are in), "Send again" after the server's countdown, "Change number".
// The code step follows CodeEntryStep (email sign-in) and its helpers. When
// the send result has messageUsUrl, "Get the code on WhatsApp" shows too —
// leading, above the field, when the code wasn't sent (codeSent: false).
export function PhoneVerificationFlow({ initialPhone, onVerified }: PhoneVerificationFlowProps) {
  const { spacing } = useTheme();
  const [sent, setSent] = useState<SentVerificationCode | null>(null);
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [sendErrorState, setSendErrorState] = useState<SendCodeError | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  // Blocks a second verify while one is in flight (auto-submit + a tap).
  const inFlight = useRef(false);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SendPhoneCodeFormValues>({
    resolver: zodResolver(sendPhoneCodeSchema),
    defaultValues: { phone: initialPhone },
  });

  const countingDown = step === 'code' || (!!sendErrorState && 'retryAt' in sendErrorState);
  const now = useNow(countingDown);
  const sendErrorText = sendCodeErrorText(sendErrorState, now);
  const tooSoon = !!sendErrorState && 'retryAt' in sendErrorState && sendErrorText !== null;
  const secondsLeft = sent ? resendSecondsLeft(sent.resendAt, now) : 0;

  // Sends (or re-sends) a code; true when one is on its way.
  const send = async (phone: string): Promise<boolean> => {
    setSendErrorState(null);
    try {
      const result = await usersApi.sendPhoneCode(phone);
      if (result.alreadyVerified) {
        // Already this account's verified number — nothing to send.
        onVerified(await usersApi.getMe());
        return false;
      }
      setSent(sentVerificationCodeNow(result));
      setCode('');
      setCodeError(null);
      setStep('code');
      return true;
    } catch (err) {
      setSendErrorState(sendCodeErrorNow(normalizeApiError(err)));
      return false;
    }
  };

  const onSubmitPhone = (values: SendPhoneCodeFormValues) => send(values.phone);

  const verify = async (value: string) => {
    if (inFlight.current) return;
    if (!isCompleteCode(value)) {
      setCodeError(`Enter the ${SIGN_IN_CODE_LENGTH}-digit code.`);
      return;
    }
    inFlight.current = true;
    setCodeError(null);
    setVerifying(true);
    try {
      const user = await usersApi.verifyPhoneCode(value);
      onVerified(user);
    } catch (err) {
      setCodeError(phoneVerificationErrorMessage(normalizeApiError(err)));
      setVerifying(false);
    } finally {
      inFlight.current = false;
    }
  };

  const onChangeCode = (raw: string) => {
    const next = normalizeCodeInput(raw);
    setCode(next);
    if (codeError) setCodeError(null);
    if (isCompleteCode(next) && !isCompleteCode(code)) void verify(next);
  };

  const resend = async () => {
    if (!sent) return;
    setResending(true);
    setCodeError(null);
    try {
      const result = await usersApi.sendPhoneCode(sent.phone);
      if (result.alreadyVerified) {
        onVerified(await usersApi.getMe());
        return;
      }
      setSent(sentVerificationCodeNow(result));
      setCode('');
    } catch (err) {
      const state = sendCodeErrorNow(normalizeApiError(err));
      // Too soon: move the countdown instead of showing an error.
      if ('retryAt' in state) setSent({ ...sent, resendAt: state.retryAt });
      else setCodeError(state.message);
    } finally {
      setResending(false);
    }
  };

  if (step === 'code' && sent) {
    // The code wasn't sent: "Get the code on WhatsApp" leads, above the field.
    const messageFirst = mustMessageForCode(sent);
    return (
      <View>
        <AppText variant="subtitle" style={{ marginBottom: spacing.xs }}>
          Enter the code
        </AppText>
        <AppText muted style={{ marginBottom: spacing.lg }}>
          {verificationCodeIntro(sent.phone, sent)}
        </AppText>

        {messageFirst && sent.messageUsUrl ? (
          <GetCodeOnWhatsApp url={sent.messageUsUrl} primary style={{ marginBottom: spacing.lg }} />
        ) : null}

        <AppInput
          label="6-digit code"
          placeholder="123456"
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          autoFocus
          value={code}
          onChangeText={onChangeCode}
          error={codeError ?? undefined}
          helperText={`The code works for ${sent.expiresInMinutes} minutes.`}
        />

        <AppButton
          title="Verify"
          variant={messageFirst ? 'outline' : 'primary'}
          loading={verifying}
          onPress={() => void verify(code)}
        />
        <AppButton
          title={resendLabel(secondsLeft)}
          variant="secondary"
          loading={resending}
          disabled={secondsLeft > 0 || verifying}
          onPress={() => void resend()}
          style={{ marginTop: spacing.md }}
        />
        {/* The code is on its way: the link stays as a fallback if it doesn't arrive. */}
        {!messageFirst && sent.messageUsUrl ? (
          <GetCodeOnWhatsApp url={sent.messageUsUrl} primary={false} style={{ marginTop: spacing.md }} />
        ) : null}
        <AppButton
          title="Change number"
          variant="ghost"
          disabled={verifying}
          onPress={() => {
            setStep('phone');
            setCodeError(null);
          }}
          style={{ marginTop: spacing.sm }}
        />
      </View>
    );
  }

  return (
    <View>
      <Controller
        control={control}
        name="phone"
        render={({ field }) => (
          <AppInput
            label="Mobile number"
            placeholder="03001234567"
            keyboardType="phone-pad"
            autoComplete="tel"
            helperText={PHONE_VERIFY_HINT}
            value={field.value}
            onChangeText={(value) => {
              field.onChange(value);
              // Editing the number clears the last send error; a "wait Ns"
              // countdown stays — the server's 60 s is per account.
              if (sendErrorState && 'message' in sendErrorState) setSendErrorState(null);
            }}
            onBlur={field.onBlur}
            error={errors.phone?.message ?? sendErrorText ?? undefined}
          />
        )}
      />

      <AppButton
        title="Send code on WhatsApp"
        loading={isSubmitting}
        disabled={tooSoon}
        onPress={handleSubmit(onSubmitPhone)}
      />

      {/* Back to a code already on its way (e.g. after "Change number"). */}
      {sent ? (
        <AppButton
          title={`Enter the code sent to ${formatPhoneForDisplay(sent.phone)}`}
          variant="ghost"
          onPress={() => setStep('code')}
          style={{ marginTop: spacing.sm }}
        />
      ) : null}

      <AppText variant="caption" muted style={{ marginTop: spacing.md }}>
        {WHATSAPP_UPDATES_SMALL_PRINT}
      </AppText>
    </View>
  );
}
