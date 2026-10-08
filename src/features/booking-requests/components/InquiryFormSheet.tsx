import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';

import { useTheme } from '../../../theme';
import { AppButton, AppInput, AppSheet, AppText, DateField } from '../../../components/ui';
import { LocationField } from '../../location/components/LocationField';
import { bookingInquirySchema, type BookingInquiryFormValues } from '../../../schemas/booking.schema';
import { useCreateBookingRequest } from '../queries';
import { normalizeApiError } from '../../../api/errors';
import { RentalDurationType } from '../../../types/enums';
import {
  computeReturnDate,
  getAvailableDurations,
  getUnitPrice,
  type VehicleRentalPrices,
} from '../../../utils/rentalDuration';
import { formatPrice } from '../../../utils/format';

interface InquiryFormSheetProps {
  visible: boolean;
  onClose: () => void;
  vehicleId: string;
  vehicleTitle: string;
  vehiclePricing: VehicleRentalPrices;
}

export function InquiryFormSheet({ visible, onClose, vehicleId, vehicleTitle, vehiclePricing }: InquiryFormSheetProps) {
  const { colors, spacing, radii } = useTheme();
  const createBooking = useCreateBookingRequest();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const availableDurations = getAvailableDurations(vehiclePricing);

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<BookingInquiryFormValues>({
    resolver: zodResolver(bookingInquirySchema),
    defaultValues: { durationType: RentalDurationType.DAY, durationQuantity: 1 },
  });

  // If DAY isn't priced for this vehicle, fall back to the first tier that is.
  useEffect(() => {
    if (availableDurations.length === 0) return;
    if (!availableDurations.some((d) => d.type === watch('durationType'))) {
      setValue('durationType', availableDurations[0].type);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId]);

  const durationType = watch('durationType');
  const durationQuantity = watch('durationQuantity');
  const fromDate = watch('requestedFromDate');
  const unitPrice = getUnitPrice(vehiclePricing, durationType);
  const totalPrice = unitPrice !== null ? unitPrice * (durationQuantity || 1) : null;
  const returnDate = fromDate && durationQuantity ? computeReturnDate(fromDate, durationType, durationQuantity) : undefined;

  const onSubmit = async (values: BookingInquiryFormValues) => {
    setSubmitError(null);
    try {
      await createBooking.mutateAsync({
        vehicleId,
        requestedFromDate: values.requestedFromDate.toISOString(),
        durationType: values.durationType,
        durationQuantity: values.durationQuantity,
        pickupLocation: values.pickupLocation || undefined,
        message: values.message || undefined,
      });
      reset();
      onClose();
      router.push('/account/inquiries');
    } catch (error) {
      setSubmitError(normalizeApiError(error).message);
    }
  };

  return (
    <AppSheet visible={visible} onClose={onClose} title="Send an inquiry" subtitle={vehicleTitle}>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Controller
          control={control}
          name="requestedFromDate"
          render={({ field }) => (
            <DateField
              label="Pick-up date & time"
              mode="datetime"
              value={field.value}
              onChange={field.onChange}
              minimumDate={new Date()}
              error={errors.requestedFromDate?.message}
            />
          )}
        />

        <AppText variant="label" style={{ marginBottom: spacing.xs }}>
          Duration
        </AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md }}>
          {availableDurations.map((option) => {
            const selected = option.type === durationType;
            const price = getUnitPrice(vehiclePricing, option.type);
            return (
              <Pressable
                key={option.type}
                onPress={() => setValue('durationType', option.type)}
                style={{
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm,
                  borderRadius: radii.md,
                  borderWidth: 1,
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? colors.primary : 'transparent',
                }}
              >
                <AppText variant="label" color={selected ? colors.primaryText : colors.text}>
                  {option.label}
                </AppText>
                <AppText variant="caption" color={selected ? colors.primaryText : colors.textMuted}>
                  {price !== null ? formatPrice(price) : ''}
                </AppText>
              </Pressable>
            );
          })}
        </View>

        <AppText variant="label" style={{ marginBottom: spacing.xs }}>
          Quantity
        </AppText>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.lg,
            marginBottom: spacing.md,
          }}
        >
          <Pressable
            onPress={() => setValue('durationQuantity', Math.max(1, (durationQuantity || 1) - 1))}
            accessibilityRole="button"
            accessibilityLabel="Decrease quantity"
            style={{
              width: 40,
              height: 40,
              borderRadius: radii.md,
              borderWidth: 1,
              borderColor: colors.border,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <AppText variant="title">−</AppText>
          </Pressable>
          <AppText variant="subtitle">{durationQuantity || 1}</AppText>
          <Pressable
            onPress={() => setValue('durationQuantity', (durationQuantity || 1) + 1)}
            accessibilityRole="button"
            accessibilityLabel="Increase quantity"
            style={{
              width: 40,
              height: 40,
              borderRadius: radii.md,
              borderWidth: 1,
              borderColor: colors.border,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <AppText variant="title">+</AppText>
          </Pressable>
        </View>

        {totalPrice !== null ? (
          <View
            style={{
              padding: spacing.md,
              borderRadius: radii.md,
              backgroundColor: colors.surfaceAlt,
              marginBottom: spacing.md,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <AppText muted variant="caption">
                Estimated total
              </AppText>
              <AppText variant="label" color={colors.primary}>
                {formatPrice(totalPrice)}
              </AppText>
            </View>
            {returnDate ? (
              <AppText muted variant="caption" style={{ marginTop: 2 }}>
                Return by {returnDate.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </AppText>
            ) : null}
            <AppText muted variant="caption" style={{ marginTop: 2 }}>
              Estimate only — final pricing confirmed by the provider.
            </AppText>
          </View>
        ) : null}

        <Controller
          control={control}
          name="pickupLocation"
          render={({ field }) => (
            <LocationField
              label="Pickup location (optional)"
              placeholder="e.g. Dubai Marina"
              value={field.value ?? ''}
              onChangeText={field.onChange}
              // BookingRequest.pickupLocation is a free-text label only —
              // no coordinate field exists for it on the backend, so a
              // map-picked point just fills the text the same as a typed one.
              onLocationChange={() => {}}
              error={errors.pickupLocation?.message}
              regionCodes={['PK', 'AE', 'SA']}
            />
          )}
        />
        <Controller
          control={control}
          name="message"
          render={({ field }) => (
            <AppInput
              label="Message (optional)"
              placeholder="Any details the provider should know"
              value={field.value}
              onChangeText={field.onChange}
              multiline
              numberOfLines={4}
              style={{ minHeight: 90, textAlignVertical: 'top', paddingTop: spacing.sm }}
              error={errors.message?.message}
            />
          )}
        />

        {submitError ? (
          <AppText color={colors.danger} style={{ marginBottom: spacing.sm }}>
            {submitError}
          </AppText>
        ) : null}
      </ScrollView>

      <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <AppButton title="Cancel" variant="secondary" onPress={onClose} />
        </View>
        <View style={{ flex: 2 }}>
          <AppButton title="Send inquiry" loading={createBooking.isPending} onPress={handleSubmit(onSubmit)} />
        </View>
      </View>
    </AppSheet>
  );
}
