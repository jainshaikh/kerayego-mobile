import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { View } from 'react-native';

import { useTheme } from '../../../theme';
import { AppButton, AppInput, AppText, DateField } from '../../../components/ui';
import { FilterChipRow } from '../../listings/components/FilterChipRow';
import { useMyApprovedUserVehicles } from '../../user-vehicles/queries';
import { tripFormSchema, type TripFormValues } from '../../../schemas/trip.schema';
import { titleCase } from '../../../utils/format';
import { parseWholeNumberInput, wholeNumberInputText } from '../../../utils/numberInput';
import { TripStopsSection } from './TripStopsSection';

interface TripFormProps {
  defaultValues?: Partial<TripFormValues>;
  onSubmit: (values: TripFormValues) => void | Promise<void>;
  submitLabel: string;
  submitting?: boolean;
}

export function TripForm({ defaultValues, onSubmit, submitLabel, submitting }: TripFormProps) {
  const { spacing } = useTheme();
  const approvedVehicles = useMyApprovedUserVehicles();

  const initialValues: Partial<TripFormValues> = {
    availableSeats: 3,
    pickupStops:
      defaultValues?.pickupStops && defaultValues.pickupStops.length > 0
        ? defaultValues.pickupStops
        : defaultValues?.pickupPoint
          ? [{ label: defaultValues.pickupPoint, lat: defaultValues.pickupLat, lng: defaultValues.pickupLng }]
          : [{ label: '' }],
    dropoffStops:
      defaultValues?.dropoffStops && defaultValues.dropoffStops.length > 0
        ? defaultValues.dropoffStops
        : defaultValues?.dropoffPoint
          ? [{ label: defaultValues.dropoffPoint, lat: defaultValues.dropoffLat, lng: defaultValues.dropoffLng }]
          : [{ label: '' }],
    ...defaultValues,
  };

  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<TripFormValues>({
    resolver: zodResolver(tripFormSchema),
    defaultValues: initialValues,
  });

  const userVehicleId = useWatch({ control, name: 'userVehicleId' });

  const vehicleOptions = (approvedVehicles.data ?? []).map((v) => ({
    label: `${titleCase(v.make)} ${titleCase(v.model)} (${v.plateNumber})`,
    value: v.id,
  }));

  const handleFormSubmit = (values: TripFormValues) => {
    const firstPickup = values.pickupStops?.[0];
    const lastDropoff = values.dropoffStops?.[values.dropoffStops.length - 1];
    return onSubmit({
      ...values,
      pickupPoint: firstPickup?.label,
      pickupLat: firstPickup?.lat,
      pickupLng: firstPickup?.lng,
      dropoffPoint: lastDropoff?.label,
      dropoffLat: lastDropoff?.lat,
      dropoffLng: lastDropoff?.lng,
    });
  };

  const pickupRootError =
    (errors.pickupStops as { message?: string; root?: { message?: string } } | undefined)?.message ||
    (errors.pickupStops as { message?: string; root?: { message?: string } } | undefined)?.root?.message;

  const dropoffRootError =
    (errors.dropoffStops as { message?: string; root?: { message?: string } } | undefined)?.message ||
    (errors.dropoffStops as { message?: string; root?: { message?: string } } | undefined)?.root?.message;

  return (
    <View>
      <AppText variant="label" style={{ marginBottom: spacing.xs }}>
        Vehicle
      </AppText>
      {vehicleOptions.length === 0 ? (
        <AppText muted style={{ marginBottom: spacing.md }}>
          You don&apos;t have an approved vehicle yet. Register one from &quot;My Vehicles&quot; and wait for admin
          approval before posting a trip.
        </AppText>
      ) : (
        <View style={{ marginBottom: spacing.md }}>
          <FilterChipRow options={vehicleOptions} value={userVehicleId} onChange={(v) => v && setValue('userVehicleId', v)} />
          {errors.userVehicleId ? (
            <AppText variant="caption" color="red" style={{ marginTop: spacing.xs }}>
              {errors.userVehicleId.message}
            </AppText>
          ) : null}
        </View>
      )}

      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <View style={{ flex: 1 }}>
          <Controller
            control={control}
            name="originCity"
            render={({ field }) => (
              <AppInput label="From" placeholder="Hyderabad" value={field.value} onChangeText={field.onChange} error={errors.originCity?.message} />
            )}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Controller
            control={control}
            name="destinationCity"
            render={({ field }) => (
              <AppInput label="To" placeholder="Karachi" value={field.value} onChangeText={field.onChange} error={errors.destinationCity?.message} />
            )}
          />
        </View>
      </View>

      <TripStopsSection kind="pickup" control={control} setValue={setValue} error={pickupRootError} />
      <TripStopsSection kind="dropoff" control={control} setValue={setValue} error={dropoffRootError} />

      <Controller
        control={control}
        name="departureAt"
        render={({ field }) => (
          <DateField
            label="Departure date & time"
            mode="datetime"
            value={field.value}
            onChange={field.onChange}
            minimumDate={new Date()}
            error={errors.departureAt?.message}
          />
        )}
      />

      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <View style={{ flex: 1 }}>
          <Controller
            control={control}
            name="availableSeats"
            render={({ field }) => (
              // Whole numbers 1–20 only (see parseWholeNumberInput); selecting
              // the text on focus lets typing replace the default 3 outright.
              <AppInput
                label="Available seats"
                keyboardType="number-pad"
                maxLength={2}
                selectTextOnFocus
                value={wholeNumberInputText(field.value)}
                onChangeText={(text) => field.onChange(parseWholeNumberInput(text))}
                onBlur={field.onBlur}
                error={errors.availableSeats?.message}
              />
            )}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Controller
            control={control}
            name="pricePerSeat"
            render={({ field }) => (
              <AppInput
                label="Price / seat"
                keyboardType="number-pad"
                maxLength={7}
                selectTextOnFocus
                value={wholeNumberInputText(field.value)}
                onChangeText={(text) => field.onChange(parseWholeNumberInput(text))}
                onBlur={field.onBlur}
                error={errors.pricePerSeat?.message}
              />
            )}
          />
        </View>
      </View>

      <Controller
        control={control}
        name="contactNumber"
        render={({ field }) => (
          <AppInput
            label="WhatsApp contact number"
            keyboardType="phone-pad"
            placeholder="+923001234567"
            value={field.value}
            onChangeText={field.onChange}
            error={errors.contactNumber?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="notes"
        render={({ field }) => (
          <AppInput
            label="Notes (optional)"
            multiline
            numberOfLines={3}
            style={{ minHeight: 70, textAlignVertical: 'top', paddingTop: spacing.sm }}
            value={field.value}
            onChangeText={field.onChange}
            error={errors.notes?.message}
          />
        )}
      />

      <AppButton
        title={submitLabel}
        loading={submitting}
        disabled={vehicleOptions.length === 0}
        onPress={handleSubmit(handleFormSubmit)}
      />
    </View>
  );
}
