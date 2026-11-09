import { useReducer, useRef, useState, type Dispatch } from 'react';
import { Pressable, View } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { authApi } from '../../../api/auth.api';
import { normalizeApiError } from '../../../api/errors';
import { useAuth } from '../../../auth/auth-context';
import { AppButton, AppInput, AppText } from '../../../components/ui';
import { useNow } from '../../../hooks/useNow';
import {
  phoneProfileSchema,
  phoneSignInSchema,
  type PhoneProfileFormValues,
  type PhoneSignInFormValues,
} from '../../../schemas/auth.schema';
import { useTheme } from '../../../theme';
import type { AuthUser, User } from '../../../types/api.types';
import type { Market } from '../../../types/enums';
import { FilterChipRow } from '../../listings/components/FilterChipRow';
import { GetCodeOnWhatsApp } from '../../phone-verification/components/GetCodeOnWhatsApp';
import {
  formatPhoneForDisplay,
  mustMessageForCode,
  sendCodeErrorNow,
  sendCodeErrorText,
  type SendCodeError,
} from '../../phone-verification/phoneVerification';
import {
  DEFAULT_PHONE_COUNTRY,
  INITIAL_PHONE_AUTH_STATE,
  PHONE_COUNTRIES,
  PHONE_SIGN_IN_MESSAGES,
  codeSentNow,
  codeStepMessage,
  composePhoneNumber,
  isSignupExpiredNow,
  phoneAuthReducer,
  phoneCountryLabel,
  phonePlaceholder,
  phoneRegisterFailure,
  phoneVerifyErrorMessage,
  signupRequiredNow,
  type PendingSignup,
  type PhoneAuthAction,
  type SentPhoneCode,
} from '../phoneSignIn';
import { SIGN_IN_CODE_LENGTH, isCompleteCode, normalizeCodeInput, resendLabel, resendSecondsLeft } from '../signInCode';

interface PhoneSignInFlowProps {
  // The number step's heading ("Welcome" on login, "Create your account" on register).
  title: string;
  onSignedIn: (user: AuthUser | User) => void;
  // "Sign in with email instead" — the email to prefill, when there is one.
  onEmailSignIn: (email?: string) => void;
}

// What was last typed on the number step — kept for "Change".
interface NumberInput {
  country: Market;
  phone: string;
}

// Phone-first sign-in and sign-up — one flow, the backend decides which:
// 1. number → POST /auth/phone/request;
// 2. the WhatsApp code → POST /auth/phone/verify (sends itself once 6 digits
//    are in): signs in, or (no account has the number) →
// 3. profile (name, email; role USER) → POST /auth/phone/register → signed in.
// State and error handling: features/auth/phoneSignIn.ts.
export function PhoneSignInFlow({ title, onSignedIn, onEmailSignIn }: PhoneSignInFlowProps) {
  const [state, dispatch] = useReducer(phoneAuthReducer, INITIAL_PHONE_AUTH_STATE);
  const [numberInput, setNumberInput] = useState<NumberInput>({ country: DEFAULT_PHONE_COUNTRY, phone: '' });

  if (state.step === 'code' && state.sent) {
    return <CodeStep sent={state.sent} dispatch={dispatch} onSignedIn={onSignedIn} />;
  }
  if (state.step === 'profile' && state.signup) {
    return <ProfileStep signup={state.signup} dispatch={dispatch} onSignedIn={onSignedIn} onEmailSignIn={onEmailSignIn} />;
  }
  return (
    <NumberStep
      title={title}
      initial={numberInput}
      onSubmitted={setNumberInput}
      sent={state.sent}
      notice={state.notice}
      dispatch={dispatch}
      onEmailSignIn={onEmailSignIn}
    />
  );
}

// ─── 1. The number ──────────────────────────────────────────────────────────

function NumberStep({
  title,
  initial,
  onSubmitted,
  sent,
  notice,
  dispatch,
  onEmailSignIn,
}: {
  title: string;
  initial: NumberInput;
  onSubmitted: (input: NumberInput) => void;
  sent: SentPhoneCode | null;
  notice: string | null;
  dispatch: Dispatch<PhoneAuthAction>;
  onEmailSignIn: (email?: string) => void;
}) {
  const { spacing, colors } = useTheme();
  const [country, setCountry] = useState<Market>(initial.country);
  const [sendErrorState, setSendErrorState] = useState<SendCodeError | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PhoneSignInFormValues>({
    resolver: zodResolver(phoneSignInSchema),
    defaultValues: { phone: initial.phone },
  });

  const countingDown = !!sendErrorState && 'retryAt' in sendErrorState;
  const now = useNow(countingDown);
  const sendErrorText = sendCodeErrorText(sendErrorState, now);
  const tooSoon = countingDown && sendErrorText !== null;

  const onSubmit = async (values: PhoneSignInFormValues) => {
    setSendErrorState(null);
    onSubmitted({ country, phone: values.phone });
    try {
      const result = await authApi.requestPhoneCode(composePhoneNumber(values.phone, country));
      dispatch(codeSentNow(result));
    } catch (err) {
      setSendErrorState(sendCodeErrorNow(normalizeApiError(err)));
    }
  };

  return (
    <View>
      <AppText variant="title" style={{ marginBottom: spacing.xs }}>
        {title}
      </AppText>
      <AppText muted style={{ marginBottom: spacing.xl }}>
        Enter your mobile number. We&apos;ll send a 6-digit code to your WhatsApp.
      </AppText>

      {notice ? (
        <AppText color={colors.danger} style={{ marginBottom: spacing.md }}>
          {notice}
        </AppText>
      ) : null}

      <AppText variant="label" style={{ marginBottom: spacing.xs }}>
        Country
      </AppText>
      <View style={{ marginBottom: spacing.md }}>
        <FilterChipRow
          options={PHONE_COUNTRIES.map((c) => ({ label: phoneCountryLabel(c), value: c }))}
          value={country}
          onChange={(next) => next && setCountry(next)}
        />
      </View>

      <Controller
        control={control}
        name="phone"
        render={({ field }) => (
          <AppInput
            label="Mobile number"
            placeholder={phonePlaceholder(country)}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            helperText="The number you use on WhatsApp."
            value={field.value}
            onChangeText={(value) => {
              field.onChange(value);
              // Editing the number clears the last send error; a "wait Ns"
              // countdown stays.
              if (sendErrorState && 'message' in sendErrorState) setSendErrorState(null);
            }}
            onBlur={field.onBlur}
            error={errors.phone?.message ?? sendErrorText ?? undefined}
          />
        )}
      />

      <AppButton title="Continue" loading={isSubmitting} disabled={tooSoon} onPress={handleSubmit(onSubmit)} />

      {/* Back to a code already on its way (after "Change"). */}
      {sent ? (
        <AppButton
          title={`Enter the code sent to ${formatPhoneForDisplay(sent.phone)}`}
          variant="ghost"
          onPress={() => dispatch({ type: 'backToCode' })}
          style={{ marginTop: spacing.sm }}
        />
      ) : null}

      <EmailSignInLink onPress={() => onEmailSignIn()} />
    </View>
  );
}

// ─── 2. The code ────────────────────────────────────────────────────────────

function CodeStep({
  sent,
  dispatch,
  onSignedIn,
}: {
  sent: SentPhoneCode;
  dispatch: Dispatch<PhoneAuthAction>;
  onSignedIn: (user: AuthUser | User) => void;
}) {
  const { spacing, colors } = useTheme();
  const { signInWithPhone } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  // Blocks a second verify while one is in flight (auto-submit + a tap).
  const inFlight = useRef(false);

  const now = useNow(true);
  const secondsLeft = resendSecondsLeft(sent.resendAt, now);
  // The code wasn't sent: "Get the code on WhatsApp" leads, above the field.
  const messageFirst = mustMessageForCode(sent);

  const submit = async (value: string) => {
    if (inFlight.current) return;
    if (!isCompleteCode(value)) {
      setError(`Enter the ${SIGN_IN_CODE_LENGTH}-digit code.`);
      return;
    }
    inFlight.current = true;
    setError(null);
    setSubmitting(true);
    try {
      const outcome = await signInWithPhone({ phone: sent.phone, code: value });
      if (outcome.needsSignup) {
        dispatch(signupRequiredNow(outcome));
      } else {
        onSignedIn(outcome.user);
      }
    } catch (err) {
      setError(phoneVerifyErrorMessage(normalizeApiError(err)));
      setSubmitting(false);
    } finally {
      inFlight.current = false;
    }
  };

  const onChangeCode = (raw: string) => {
    const next = normalizeCodeInput(raw);
    setCode(next);
    if (error) setError(null);
    if (isCompleteCode(next) && !isCompleteCode(code)) void submit(next);
  };

  const resend = async () => {
    setError(null);
    setResending(true);
    try {
      const result = await authApi.requestPhoneCode(sent.phone);
      dispatch(codeSentNow(result));
      setCode('');
    } catch (err) {
      const state = sendCodeErrorNow(normalizeApiError(err));
      // Too soon: move the countdown instead of showing an error.
      if ('retryAt' in state) dispatch({ type: 'resendDelayed', retryAt: state.retryAt });
      else setError(state.message);
    } finally {
      setResending(false);
    }
  };

  return (
    <View>
      <AppText variant="title" style={{ marginBottom: spacing.xs }}>
        Enter your code
      </AppText>
      <AppText muted style={{ marginBottom: spacing.xs }}>
        {codeStepMessage(sent)}
      </AppText>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xl }}>
        <AppText>{formatPhoneForDisplay(sent.phone)}</AppText>
        <Pressable
          onPress={() => dispatch({ type: 'changeNumber' })}
          disabled={submitting}
          accessibilityRole="button"
          hitSlop={8}
        >
          <AppText color={colors.primary}>Change</AppText>
        </Pressable>
      </View>

      {messageFirst && sent.messageUsUrl ? (
        <GetCodeOnWhatsApp url={sent.messageUsUrl} primary style={{ marginBottom: spacing.xl }} />
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
        error={error ?? undefined}
        helperText={`The code works for ${sent.expiresInMinutes} minutes.`}
      />

      <AppButton
        title="Continue"
        variant={messageFirst ? 'outline' : 'primary'}
        loading={submitting}
        onPress={() => void submit(code)}
      />

      <AppButton
        title={resendLabel(secondsLeft)}
        variant="secondary"
        loading={resending}
        disabled={secondsLeft > 0 || submitting}
        onPress={() => void resend()}
        style={{ marginTop: spacing.md }}
      />

      {/* The code is on its way: the link stays as a fallback if it doesn't arrive. */}
      {!messageFirst && sent.messageUsUrl ? (
        <GetCodeOnWhatsApp url={sent.messageUsUrl} primary={false} style={{ marginTop: spacing.md }} />
      ) : null}
    </View>
  );
}

// ─── 3. Profile (new account) ───────────────────────────────────────────────

function ProfileStep({
  signup,
  dispatch,
  onSignedIn,
  onEmailSignIn,
}: {
  signup: PendingSignup;
  dispatch: Dispatch<PhoneAuthAction>;
  onSignedIn: (user: AuthUser | User) => void;
  onEmailSignIn: (email?: string) => void;
}) {
  const { spacing, colors } = useTheme();
  const { registerWithPhone } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  // After 409 EMAIL_TAKEN: the email sign-in link, for that email.
  const [takenEmail, setTakenEmail] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PhoneProfileFormValues>({
    resolver: zodResolver(phoneProfileSchema),
    defaultValues: { name: '', email: '' },
  });

  const onSubmit = async (values: PhoneProfileFormValues) => {
    setFormError(null);
    setTakenEmail(null);
    if (isSignupExpiredNow(signup)) {
      dispatch({ type: 'restart', notice: PHONE_SIGN_IN_MESSAGES.SIGNUP_EXPIRED });
      return;
    }
    try {
      const user = await registerWithPhone({ signupToken: signup.signupToken, name: values.name, email: values.email });
      onSignedIn(user);
    } catch (err) {
      const failure = phoneRegisterFailure(normalizeApiError(err));
      if (failure.type === 'restart') {
        dispatch({ type: 'restart', notice: failure.message });
      } else if (failure.type === 'field') {
        setError(failure.field, { type: 'server', message: failure.message });
        if (failure.offerEmailSignIn) setTakenEmail(values.email);
      } else {
        setFormError(failure.message);
      }
    }
  };

  return (
    <View>
      <AppText variant="title" style={{ marginBottom: spacing.xs }}>
        Create your account
      </AppText>
      <AppText muted style={{ marginBottom: spacing.xl }}>
        {`${formatPhoneForDisplay(signup.phone)} is verified. Add your name and email to finish.`}
      </AppText>

      <Controller
        control={control}
        name="name"
        render={({ field }) => (
          <AppInput
            label="Full name"
            autoComplete="name"
            textContentType="name"
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
            placeholder="you@example.com"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={field.value}
            onChangeText={(value) => {
              field.onChange(value);
              if (takenEmail) setTakenEmail(null);
            }}
            onBlur={field.onBlur}
            error={errors.email?.message}
          />
        )}
      />

      {takenEmail ? <EmailSignInLink onPress={() => onEmailSignIn(takenEmail)} spaced={false} /> : null}

      {formError ? (
        <AppText color={colors.danger} style={{ marginBottom: spacing.md }}>
          {formError}
        </AppText>
      ) : null}

      <AppButton title="Create account" loading={isSubmitting} onPress={handleSubmit(onSubmit)} />
      <AppButton
        title="Use a different number"
        variant="ghost"
        disabled={isSubmitting}
        onPress={() => dispatch({ type: 'restart' })}
        style={{ marginTop: spacing.sm }}
      />
    </View>
  );
}

// ─── "Sign in with email instead" ───────────────────────────────────────────

function EmailSignInLink({ onPress, spaced = true }: { onPress: () => void; spaced?: boolean }) {
  const { spacing, colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      hitSlop={8}
      style={{ alignSelf: 'center', marginTop: spaced ? spacing.lg : 0, marginBottom: spaced ? 0 : spacing.md }}
    >
      <AppText variant="caption" color={colors.primary}>
        Sign in with email instead
      </AppText>
    </Pressable>
  );
}
