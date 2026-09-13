import { useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';

import { useTheme } from '../../../theme';
import { AppButton, AppInput, AppText } from '../../../components/ui';
import { tripInquirySchema, type TripInquiryFormValues } from '../../../schemas/trip-inquiry.schema';
import { useCreateTripInquiry } from '../../trip-inquiries/queries';
import { normalizeApiError } from '../../../api/errors';
import type { TripStop } from '../../../types/api.types';

interface TripInquiryFormSheetProps {
  visible: boolean;
  onClose: () => void;
  tripId: string;
  routeLabel: string; // e.g. "Lahore → Islamabad"
  availableSeats: number;
  stops: TripStop[];
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors, radii, spacing } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: radii.chip,
        borderWidth: 1,
        borderColor: active ? colors.primary : colors.border,
        backgroundColor: active ? colors.primary : 'transparent',
      }}
    >
      <AppText variant="caption" color={active ? colors.primaryText : colors.text}>
        {label}
      </AppText>
    </Pressable>
  );
}

export function TripInquiryFormSheet({ visible, onClose, tripId, routeLabel, availableSeats, stops }: TripInquiryFormSheetProps) {
  const { colors, spacing } = useTheme();
  const createInquiry = useCreateTripInquiry();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [selectedPickupStopId, setSelectedPickupStopId] = useState<string | null>(null);
  const [selectedDropoffStopId, setSelectedDropoffStopId] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<TripInquiryFormValues>({
    resolver: zodResolver(tripInquirySchema),
    defaultValues: { requestedSeats: 1 },
  });

  const requestedSeats = watch('requestedSeats') ?? 1;
  const maxSeats = Math.max(1, availableSeats);
  const pickupStops = stops.filter((s) => s.type === 'PICKUP');
  const dropoffStops = stops.filter((s) => s.type === 'DROPOFF');
  const canSubmitStops = pickupStops.length > 0 && dropoffStops.length > 0;
  const stopsSelected = !!selectedPickupStopId && !!selectedDropoffStopId;

  const onSubmit = async (values: TripInquiryFormValues) => {
    setSubmitError(null);
    if (!selectedPickupStopId || !selectedDropoffStopId) return;

    try {
      await createInquiry.mutateAsync({
        tripId,
        requestedSeats: values.requestedSeats,
        pickupStopId: selectedPickupStopId,
        dropoffStopId: selectedDropoffStopId,
        pickupNote: values.pickupNote || undefined,
        message: values.message || undefined,
      });
      reset({ requestedSeats: 1 });
      setSelectedPickupStopId(null);
      setSelectedDropoffStopId(null);
      onClose();
      router.push('/account/trip-requests');
    } catch (error) {
      setSubmitError(normalizeApiError(error).message);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
        <View
          style={{
            backgroundColor: colors.background,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            maxHeight: '90%',
            padding: spacing.lg,
          }}
        >
          <AppText variant="subtitle" style={{ marginBottom: spacing.xs }}>
            Request seats
          </AppText>
          <AppText muted variant="caption" style={{ marginBottom: spacing.md }} numberOfLines={1}>
            {routeLabel}
          </AppText>

          <ScrollView keyboardShouldPersistTaps="handled">
            <AppText variant="label" style={{ marginBottom: spacing.xs }}>
              Seats needed
            </AppText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm }}>
              <Pressable
                onPress={() => setValue('requestedSeats', Math.max(1, requestedSeats - 1))}
                disabled={requestedSeats <= 1}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: colors.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: requestedSeats <= 1 ? 0.4 : 1,
                }}
              >
                <AppText variant="subtitle">–</AppText>
              </Pressable>
              <AppText variant="subtitle" style={{ width: 32, textAlign: 'center' }}>
                {requestedSeats}
              </AppText>
              <Pressable
                onPress={() => setValue('requestedSeats', Math.min(maxSeats, requestedSeats + 1))}
                disabled={requestedSeats >= maxSeats}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: colors.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: requestedSeats >= maxSeats ? 0.4 : 1,
                }}
              >
                <AppText variant="subtitle">+</AppText>
              </Pressable>
              <AppText muted variant="caption">
                {availableSeats} available
              </AppText>
            </View>
            {errors.requestedSeats ? (
              <AppText color={colors.danger} variant="caption" style={{ marginBottom: spacing.sm }}>
                {errors.requestedSeats.message}
              </AppText>
            ) : null}

            <View style={{ marginBottom: spacing.md }}>
              <AppText variant="label" style={{ marginBottom: spacing.xs }}>
                Pickup point
              </AppText>
              {pickupStops.length > 0 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                  {pickupStops.map((stop) => (
                    <Chip
                      key={stop.id}
                      label={stop.label}
                      active={selectedPickupStopId === stop.id}
                      onPress={() => setSelectedPickupStopId((current) => (current === stop.id ? null : stop.id))}
                    />
                  ))}
                </View>
              ) : (
                <AppText color={colors.danger} variant="caption">
                  This trip has no valid pickup points — contact the driver.
                </AppText>
              )}
            </View>

            <View style={{ marginBottom: spacing.md }}>
              <AppText variant="label" style={{ marginBottom: spacing.xs }}>
                Drop-off point
              </AppText>
              {dropoffStops.length > 0 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                  {dropoffStops.map((stop) => (
                    <Chip
                      key={stop.id}
                      label={stop.label}
                      active={selectedDropoffStopId === stop.id}
                      onPress={() => setSelectedDropoffStopId((current) => (current === stop.id ? null : stop.id))}
                    />
                  ))}
                </View>
              ) : (
                <AppText color={colors.danger} variant="caption">
                  This trip has no valid drop-off points — contact the driver.
                </AppText>
              )}
            </View>

            <Controller
              control={control}
              name="pickupNote"
              render={({ field }) => (
                <AppInput
                  label="Pickup note (optional)"
                  placeholder="e.g. Near the mosque, not the main gate"
                  value={field.value}
                  onChangeText={field.onChange}
                  error={errors.pickupNote?.message}
                />
              )}
            />
            <Controller
              control={control}
              name="message"
              render={({ field }) => (
                <AppInput
                  label="Message (optional)"
                  placeholder="Introduce yourself or ask a question"
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
              <AppButton
                title="Send request"
                loading={createInquiry.isPending}
                disabled={!canSubmitStops || !stopsSelected}
                onPress={handleSubmit(onSubmit)}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
