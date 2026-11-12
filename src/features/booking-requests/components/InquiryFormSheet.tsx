import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';

import { useTheme } from '../../../theme';
import { AppButton, AppInput, AppSheet, AppText, DateField } from '../../../components/ui';
import { TripStopsSection } from '../../trips/components/TripStopsSection';
import { rentalRequestSchema, type RentalRequestFormValues } from '../../../schemas/booking.schema';
import { useBookingEstimate, useCreateBookingRequest } from '../queries';
import { normalizeApiError } from '../../../api/errors';
import { IdentityHoldBanner } from '../../identity/components/IdentityHoldBanner';
import { useIdentityHold } from '../../identity/useIdentityHold';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { BookingTripType, RentalDurationType } from '../../../types/enums';
import type { RentalPackageChoice } from '../../../types/api.types';
import type { EstimateBookingPayload } from '../../../api/booking-requests.api';
import {
  COUNT_LIMITS,
  PRICE_TO_AGREE,
  clampCount,
  computeReturnDate,
  countLabel,
  defaultPackage,
  isPriceToAgree,
  packageLabel,
  packageOptions,
  packageTotal,
  type RentalPackagePrices,
} from '../../../utils/rentalDuration';
import { parseWholeNumberInput, wholeNumberInputText } from '../../../utils/numberInput';
import { formatPrice } from '../../../utils/format';
import {
  MAX_RENTAL_STOPS,
  choosePackageLabel,
  createPayloadOf,
  estimateInputOf,
  rentalRequestFailure,
  stopsPayload,
  type RequestFailure,
} from '../rentalRequest';
import { TRIP_TYPE_LABELS, bookingTimeLabel } from '../bookingRoute';
import { withEndStopCities } from '../stopCities';
import { EstimatePanel } from './EstimatePanel';
import { Stepper } from './Stepper';

/** What the request sheet needs to know about the car (a listing card or the car page). */
export interface RentalRequestCar extends RentalPackagePrices {
  id: string;
  title: string;
  seatingCapacity: number;
}

interface InquiryFormSheetProps {
  visible: boolean;
  onClose: () => void;
  car: RentalRequestCar;
  // Opened from "Ask for a price" (weekly & monthly): start on Week.
  weeklyMonthly?: boolean;
}

// The estimate endpoint allows 20 a minute: wait for the form to settle.
const ESTIMATE_DEBOUNCE_MS = 700;

const TRIP_TYPE_HINTS: Record<BookingTripType, string> = {
  [BookingTripType.ONE_WAY]: 'The trip ends at the last drop-off',
  [BookingTripType.ROUND_TRIP]: 'The driver brings everyone back',
};

function defaultsFor(car: RentalRequestCar, weeklyMonthly: boolean): Partial<RentalRequestFormValues> {
  return {
    durationType: defaultPackage(car, weeklyMonthly),
    durationQuantity: 1,
    tripType: null,
    pickupStops: [{ label: '' }],
    dropoffStops: [{ label: '' }],
    passengerCount: 1,
    driverHoursPerDay: 10,
    daysPerWeek: 6,
    kmPerMonth: null,
    message: '',
  };
}

// A customer's rental request (plan §3c, A74–A85): the package (6 hours, 12
// hours, days — or Week/Month, "price to agree", on a car switched on for
// it), the count only where it applies, the pickup time, One way / Round
// trip, the pickup and drop-off points (picked by search or on the map),
// passengers, and for week/month the driver's hours per day, days per week
// and km per month. Priced packages show the route estimate as it's filled
// in and can't be sent when the trip doesn't fit — the panel offers the
// package that does. Sends POST /booking-requests in the new shape.
export function InquiryFormSheet({ visible, onClose, car, weeklyMonthly = false }: InquiryFormSheetProps) {
  const { colors, spacing, radii } = useTheme();
  const createBooking = useCreateBookingRequest();
  const hold = useIdentityHold();
  const [failure, setFailure] = useState<RequestFailure | null>(null);

  const schema = useMemo(() => rentalRequestSchema(car.seatingCapacity), [car.seatingCapacity]);
  const options = packageOptions(car);

  const {
    control,
    handleSubmit,
    setValue,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RentalRequestFormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultsFor(car, weeklyMonthly),
  });

  const [requestedFromDate, durationType, durationQuantity, tripType, pickupStops, dropoffStops, passengerCount] =
    useWatch({
      control,
      name: [
        'requestedFromDate',
        'durationType',
        'durationQuantity',
        'tripType',
        'pickupStops',
        'dropoffStops',
        'passengerCount',
      ],
    });

  const priceToAgree = isPriceToAgree(durationType);
  const limits = COUNT_LIMITS[durationType];
  const total = packageTotal(car, durationType, durationQuantity);

  // The estimate, asked once the form has what it needs and the input has
  // stayed the same for a moment (rentalRequest.estimateInputOf).
  const input = estimateInputOf(
    {
      requestedFromDate,
      durationType,
      durationQuantity,
      tripType,
      pickupStops: pickupStops ?? [],
      dropoffStops: dropoffStops ?? [],
      passengerCount,
      driverHoursPerDay: 0,
      daysPerWeek: 0,
      kmPerMonth: null,
    },
    car.id,
  );
  const inputKey = input ? JSON.stringify(input) : null;
  const settledKey = useDebouncedValue(inputKey, ESTIMATE_DEBOUNCE_MS);
  const settledInput = useMemo(
    () => (settledKey ? (JSON.parse(settledKey) as EstimateBookingPayload) : null),
    [settledKey],
  );
  const estimate = useBookingEstimate(settledInput);
  const estimateCurrent = inputKey !== null && inputKey === settledKey;
  const checking = inputKey !== settledKey || estimate.isFetching;
  // "If the trip can't fit in the chosen package it can't be sent" (A77).
  const doesNotFit = estimateCurrent && !estimate.isFetching && estimate.data?.selected?.fits === false;

  const choosePackage = (type: RentalDurationType, quantity?: number) => {
    setFailure(null);
    setValue('durationType', type, { shouldValidate: false });
    setValue('durationQuantity', clampCount(type, quantity ?? durationQuantity));
  };
  const applySuggestion = (choice: RentalPackageChoice) => choosePackage(choice.durationType, choice.durationQuantity);

  const onSubmit = async (values: RentalRequestFormValues) => {
    setFailure(null);
    try {
      const stops = await withEndStopCities(stopsPayload(values.pickupStops, values.dropoffStops));
      await createBooking.mutateAsync(createPayloadOf(values, car.id, stops));
      reset(defaultsFor(car, weeklyMonthly));
      onClose();
      router.push('/account/inquiries');
    } catch (error) {
      const normalized = normalizeApiError(error);
      // On hold: the banner shows the server's message instead.
      if (hold.handleHoldError(normalized)) return;
      const next = rentalRequestFailure(normalized);
      if (next.field) {
        setError(next.field, { message: next.message });
        return;
      }
      setFailure(next);
    }
  };

  const handleClose = () => {
    hold.clearRefusal();
    setFailure(null);
    onClose();
  };

  const openMyInquiries = () => {
    handleClose();
    router.push('/account/inquiries');
  };

  const chip = (selected: boolean) => ({
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: selected ? colors.primary : colors.border,
    backgroundColor: selected ? colors.primary : 'transparent',
  });

  const offersLongRentals = options.some((option) => isPriceToAgree(option.type));
  const otherStops = { pickup: dropoffStops?.length ?? 0, dropoff: pickupStops?.length ?? 0 };
  const endsAt = requestedFromDate && priceToAgree ? computeReturnDate(requestedFromDate, durationType, durationQuantity) : null;

  return (
    <AppSheet visible={visible} onClose={handleClose} title="Request this car" subtitle={car.title}>
      <ScrollView keyboardShouldPersistTaps="handled">
        {/* A refused submit shows its banner down by the buttons instead. */}
        <IdentityHoldBanner message={hold.refusedMessage ? null : hold.notice} />

        {/* ── Package ─────────────────────────────────────────────────── */}
        <AppText variant="label" style={{ marginBottom: spacing.xs }}>
          Package
        </AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md }}>
          {options.map((option) => {
            const selected = option.type === durationType;
            return (
              <Pressable
                key={option.type}
                onPress={() => choosePackage(option.type)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={chip(selected)}
              >
                <AppText variant="label" color={selected ? colors.primaryText : colors.text}>
                  {option.label}
                </AppText>
                <AppText variant="caption" color={selected ? colors.primaryText : colors.textMuted}>
                  {option.price !== null
                    ? `${formatPrice(option.price)}${option.type === RentalDurationType.DAY ? ' / day' : ''}`
                    : PRICE_TO_AGREE}
                </AppText>
              </Pressable>
            );
          })}
        </View>

        {limits ? (
          <Stepper
            label={countLabel(durationType) ?? 'Number'}
            value={clampCount(durationType, durationQuantity)}
            min={limits.min}
            max={limits.max}
            onChange={(next) => setValue('durationQuantity', next)}
            hint={
              durationType === RentalDurationType.DAY
                ? offersLongRentals
                  ? 'Up to 6 days. For 7 days or more, choose Week or Month.'
                  : 'Up to 6 days.'
                : undefined
            }
            error={errors.durationQuantity?.message}
          />
        ) : null}

        <Controller
          control={control}
          name="requestedFromDate"
          render={({ field }) => (
            <DateField
              label={priceToAgree ? 'Start date & time' : 'Pickup date & time'}
              mode="datetime"
              value={field.value}
              onChange={field.onChange}
              minimumDate={new Date()}
              error={errors.requestedFromDate?.message}
            />
          )}
        />

        {/* ── Trip type (priced packages, A76) ────────────────────────── */}
        {!priceToAgree ? (
          <View style={{ marginBottom: spacing.md }}>
            <AppText variant="label" style={{ marginBottom: spacing.xs }}>
              Trip
            </AppText>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {[BookingTripType.ONE_WAY, BookingTripType.ROUND_TRIP].map((type) => {
                const selected = tripType === type;
                return (
                  <Pressable
                    key={type}
                    onPress={() => setValue('tripType', type, { shouldValidate: !!errors.tripType })}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    style={[chip(selected), { flex: 1 }]}
                  >
                    <AppText variant="label" color={selected ? colors.primaryText : colors.text}>
                      {TRIP_TYPE_LABELS[type]}
                    </AppText>
                    <AppText variant="caption" color={selected ? colors.primaryText : colors.textMuted}>
                      {TRIP_TYPE_HINTS[type]}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
            {errors.tripType?.message ? (
              <AppText variant="caption" color={colors.danger} style={{ marginTop: spacing.xs }}>
                {errors.tripType.message}
              </AppText>
            ) : null}
          </View>
        ) : null}

        {/* ── Pickups and drop-offs (A75) ─────────────────────────────── */}
        <TripStopsSection
          kind="pickup"
          variant="rental"
          control={control}
          setValue={setValue}
          maxStops={MAX_RENTAL_STOPS - otherStops.pickup}
          hint={priceToAgree ? 'Where the rental starts — the driver picks you up here.' : undefined}
          error={errors.pickupStops?.message ?? errors.pickupStops?.root?.message}
        />
        <TripStopsSection
          kind="dropoff"
          variant="rental"
          control={control}
          setValue={setValue}
          maxStops={MAX_RENTAL_STOPS - otherStops.dropoff}
          hint={priceToAgree ? 'Where the rental ends and the car is handed back.' : undefined}
          error={errors.dropoffStops?.message ?? errors.dropoffStops?.root?.message}
        />

        <Stepper
          label="Passengers"
          value={passengerCount ?? 1}
          min={1}
          max={Math.max(1, car.seatingCapacity)}
          onChange={(next) => setValue('passengerCount', next)}
          hint={`This car takes up to ${car.seatingCapacity}.`}
          error={errors.passengerCount?.message}
        />

        {/* ── Week / month: what the business needs to quote (A85) ────── */}
        {priceToAgree ? (
          <>
            <Controller
              control={control}
              name="driverHoursPerDay"
              render={({ field }) => (
                <Stepper
                  label="Driver's hours per day"
                  value={field.value}
                  min={1}
                  max={24}
                  onChange={field.onChange}
                  unit="h"
                  error={errors.driverHoursPerDay?.message}
                />
              )}
            />
            <Controller
              control={control}
              name="daysPerWeek"
              render={({ field }) => (
                <Stepper
                  label="Days per week"
                  value={field.value}
                  min={1}
                  max={7}
                  onChange={field.onChange}
                  error={errors.daysPerWeek?.message}
                />
              )}
            />
            <Controller
              control={control}
              name="kmPerMonth"
              render={({ field }) => (
                <AppInput
                  label="Kilometres per month (optional)"
                  placeholder="e.g. 2500"
                  keyboardType="number-pad"
                  value={wholeNumberInputText(field.value)}
                  onChangeText={(text) => field.onChange(parseWholeNumberInput(text))}
                  helperText="Roughly — it helps the business quote."
                  error={errors.kmPerMonth?.message}
                />
              )}
            />
          </>
        ) : (
          <EstimatePanel
            ready={input !== null}
            checking={checking}
            estimate={estimateCurrent ? estimate.data : undefined}
            error={estimateCurrent ? estimate.error : null}
            tripType={tripType}
            onRetry={() => void estimate.refetch()}
            onChoose={applySuggestion}
          />
        )}

        {/* ── Price ─────────────────────────────────────────────────────── */}
        <View
          style={{
            padding: spacing.md,
            borderRadius: radii.md,
            borderWidth: 1,
            borderColor: colors.border,
            marginBottom: spacing.md,
          }}
        >
          {priceToAgree ? (
            <>
              <AppText variant="label">{PRICE_TO_AGREE}</AppText>
              <AppText muted variant="caption" style={{ marginTop: 2 }}>
                {packageLabel(durationType, durationQuantity)}. The business will call you to agree the price.
              </AppText>
              {endsAt ? (
                <AppText muted variant="caption" style={{ marginTop: 2 }}>
                  Ends {bookingTimeLabel(endsAt.toISOString())}
                </AppText>
              ) : null}
            </>
          ) : (
            <>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <AppText muted variant="caption">
                  Total for {packageLabel(durationType, durationQuantity)}
                </AppText>
                <AppText variant="label" color={colors.primary}>
                  {total !== null ? formatPrice(total) : '—'}
                </AppText>
              </View>
              <AppText muted variant="caption" style={{ marginTop: 2 }}>
                The business confirms the booking after checking your request.
              </AppText>
            </>
          )}
        </View>

        <Controller
          control={control}
          name="message"
          render={({ field }) => (
            <AppInput
              label="Message (optional)"
              placeholder="Anything the business should know"
              value={field.value}
              onChangeText={field.onChange}
              multiline
              numberOfLines={4}
              style={{ minHeight: 90, textAlignVertical: 'top', paddingTop: spacing.sm }}
              error={errors.message?.message}
            />
          )}
        />

        <IdentityHoldBanner message={hold.refusedMessage} style={{ marginBottom: spacing.sm }} />
        {failure ? (
          <AppText color={colors.danger} style={{ marginBottom: spacing.sm }}>
            {failure.message}
          </AppText>
        ) : null}
        {failure?.suggestion ? (
          <AppButton
            title={choosePackageLabel(failure.suggestion)}
            variant="outline"
            onPress={() => failure.suggestion && applySuggestion(failure.suggestion)}
            style={{ marginBottom: spacing.sm }}
          />
        ) : null}
        {failure?.duplicate ? (
          <AppButton
            title="View my inquiries"
            variant="outline"
            onPress={openMyInquiries}
            style={{ marginBottom: spacing.sm }}
          />
        ) : null}
      </ScrollView>

      <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <AppButton title="Cancel" variant="secondary" onPress={handleClose} />
        </View>
        <View style={{ flex: 2 }}>
          <AppButton
            title={priceToAgree ? 'Ask for a price' : 'Send request'}
            loading={isSubmitting}
            disabled={doesNotFit}
            onPress={handleSubmit(onSubmit)}
          />
        </View>
      </View>
    </AppSheet>
  );
}
