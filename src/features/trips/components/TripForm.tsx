import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../../../theme';
import { AppButton, AppInput, AppText, DateField } from '../../../components/ui';
import { LocationField } from '../../location/components/LocationField';
import { FilterChipRow } from '../../listings/components/FilterChipRow';
import { useMyApprovedUserVehicles } from '../../user-vehicles/queries';
import { tripFormSchema, type TripFormValues } from '../../../schemas/trip.schema';
import { titleCase } from '../../../utils/format';

interface TripFormProps {
  defaultValues?: Partial<TripFormValues>;
  onSubmit: (values: TripFormValues) => void | Promise<void>;
  submitLabel: string;
  submitting?: boolean;
}

export function TripForm({ defaultValues, onSubmit, submitLabel, submitting }: TripFormProps) {
  const { colors, spacing } = useTheme();
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
    watch,
    formState: { errors },
  } = useForm<TripFormValues>({
    resolver: zodResolver(tripFormSchema),
    defaultValues: initialValues,
  });

  const {
    fields: pickupFields,
    append: appendPickup,
    remove: removePickup,
  } = useFieldArray({
    control,
    name: 'pickupStops',
  });

  const {
    fields: dropoffFields,
    append: appendDropoff,
    remove: removeDropoff,
  } = useFieldArray({
    control,
    name: 'dropoffStops',
  });

  const userVehicleId = watch('userVehicleId');

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

      {/* Pickup Points Section */}
      <View style={{ marginBottom: spacing.md }}>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: spacing.xs,
          }}
        >
          <AppText variant="label">
            Pickup Points <AppText color={colors.danger}>*</AppText>
          </AppText>
          {pickupFields.length < 10 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add another pickup point"
              onPress={() => appendPickup({ label: '' })}
              hitSlop={8}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
            >
              <Ionicons name="add-circle-outline" size={16} color={colors.primary} />
              <AppText variant="caption" color={colors.primary} style={{ fontWeight: '600' }}>
                Add stop
              </AppText>
            </Pressable>
          ) : null}
        </View>

        {pickupFields.length > 1 ? (
          <AppText muted variant="caption" style={{ marginBottom: spacing.sm }}>
            Riders can choose to be picked up at any of these points along your route.
          </AppText>
        ) : null}

        {pickupFields.map((field, index) => (
          <View key={field.id} style={{ marginBottom: spacing.xs }}>
            {pickupFields.length > 1 ? (
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 4,
                }}
              >
                <AppText variant="caption" muted style={{ fontWeight: '600' }}>
                  Stop {index + 1}
                </AppText>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove pickup stop ${index + 1}`}
                  onPress={() => removePickup(index)}
                  hitSlop={8}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
                >
                  <Ionicons name="trash-outline" size={14} color={colors.danger} />
                  <AppText variant="caption" color={colors.danger}>
                    Remove
                  </AppText>
                </Pressable>
              </View>
            ) : null}

            <Controller
              control={control}
              name={`pickupStops.${index}.label`}
              render={({ field: inputField, fieldState }) => (
                <LocationField
                  placeholder={
                    index === 0
                      ? 'Liaquatabad Chowrangi, near Total Petrol Pump'
                      : 'Additional pickup stop'
                  }
                  value={inputField.value ?? ''}
                  onChangeText={inputField.onChange}
                  lat={watch(`pickupStops.${index}.lat`)}
                  lng={watch(`pickupStops.${index}.lng`)}
                  onLocationChange={(lat, lng) => {
                    setValue(`pickupStops.${index}.lat`, lat, { shouldDirty: true });
                    setValue(`pickupStops.${index}.lng`, lng, { shouldDirty: true });
                  }}
                  error={fieldState.error?.message}
                  regionCodes={['PK', 'AE', 'SA']}
                />
              )}
            />
          </View>
        ))}

        {pickupFields.length < 10 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add another pickup point"
            onPress={() => appendPickup({ label: '' })}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingVertical: spacing.xs,
              marginBottom: spacing.sm,
              alignSelf: 'flex-start',
            }}
          >
            <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
            <AppText color={colors.primary} style={{ fontWeight: '600', fontSize: 13 }}>
              Add another pickup point
            </AppText>
          </Pressable>
        )}

        {pickupRootError ? (
          <AppText variant="caption" color={colors.danger} style={{ marginBottom: spacing.sm }}>
            {pickupRootError}
          </AppText>
        ) : null}
      </View>

      {/* Drop-off Points Section */}
      <View style={{ marginBottom: spacing.md }}>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: spacing.xs,
          }}
        >
          <AppText variant="label">
            Drop-off Points <AppText color={colors.danger}>*</AppText>
          </AppText>
          {dropoffFields.length < 10 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add another drop-off point"
              onPress={() => appendDropoff({ label: '' })}
              hitSlop={8}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
            >
              <Ionicons name="add-circle-outline" size={16} color={colors.primary} />
              <AppText variant="caption" color={colors.primary} style={{ fontWeight: '600' }}>
                Add stop
              </AppText>
            </Pressable>
          ) : null}
        </View>

        {dropoffFields.length > 1 ? (
          <AppText muted variant="caption" style={{ marginBottom: spacing.sm }}>
            Riders can choose to be dropped off at any of these points along your route.
          </AppText>
        ) : null}

        {dropoffFields.map((field, index) => (
          <View key={field.id} style={{ marginBottom: spacing.xs }}>
            {dropoffFields.length > 1 ? (
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 4,
                }}
              >
                <AppText variant="caption" muted style={{ fontWeight: '600' }}>
                  Stop {index + 1}
                </AppText>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove drop-off stop ${index + 1}`}
                  onPress={() => removeDropoff(index)}
                  hitSlop={8}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
                >
                  <Ionicons name="trash-outline" size={14} color={colors.danger} />
                  <AppText variant="caption" color={colors.danger}>
                    Remove
                  </AppText>
                </Pressable>
              </View>
            ) : null}

            <Controller
              control={control}
              name={`dropoffStops.${index}.label`}
              render={({ field: inputField, fieldState }) => (
                <LocationField
                  placeholder={
                    index === 0
                      ? 'Drop-off near Karachi Cantt Station'
                      : 'Additional drop-off stop'
                  }
                  value={inputField.value ?? ''}
                  onChangeText={inputField.onChange}
                  lat={watch(`dropoffStops.${index}.lat`)}
                  lng={watch(`dropoffStops.${index}.lng`)}
                  onLocationChange={(lat, lng) => {
                    setValue(`dropoffStops.${index}.lat`, lat, { shouldDirty: true });
                    setValue(`dropoffStops.${index}.lng`, lng, { shouldDirty: true });
                  }}
                  error={fieldState.error?.message}
                  regionCodes={['PK', 'AE', 'SA']}
                />
              )}
            />
          </View>
        ))}

        {dropoffFields.length < 10 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add another drop-off point"
            onPress={() => appendDropoff({ label: '' })}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingVertical: spacing.xs,
              marginBottom: spacing.sm,
              alignSelf: 'flex-start',
            }}
          >
            <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
            <AppText color={colors.primary} style={{ fontWeight: '600', fontSize: 13 }}>
              Add another drop-off point
            </AppText>
          </Pressable>
        )}

        {dropoffRootError ? (
          <AppText variant="caption" color={colors.danger} style={{ marginBottom: spacing.sm }}>
            {dropoffRootError}
          </AppText>
        ) : null}
      </View>

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
              <AppInput
                label="Available seats"
                keyboardType="numeric"
                value={field.value?.toString() ?? ''}
                onChangeText={(v) => field.onChange(v ? Number(v) : undefined)}
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
                keyboardType="numeric"
                value={field.value?.toString() ?? ''}
                onChangeText={(v) => field.onChange(v ? Number(v) : undefined)}
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
