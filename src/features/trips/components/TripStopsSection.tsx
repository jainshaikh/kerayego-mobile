import { Controller, useFieldArray, useWatch, type Control, type UseFormSetValue } from 'react-hook-form';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AppCard, AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';
import { LocationField } from '../../location/components/LocationField';
import type { TripFormValues } from '../../../schemas/trip.schema';

type StopKind = 'pickup' | 'dropoff';

const MAX_STOPS = 10;
const REGION_CODES = ['PK', 'AE', 'SA'];
const MARKER_SIZE = 24;
// Centres the marker/remove button on AppInput's 48px-tall box.
const INPUT_CENTER_OFFSET = (48 - MARKER_SIZE) / 2;

const COPY = {
  pickup: {
    name: 'pickupStops',
    title: 'Pickup points',
    hint: "Where riders get in. Add more if you'll pick up at several spots along the way.",
    icon: 'radio-button-on',
    firstPlaceholder: 'Liaquatabad Chowrangi, near Total Petrol Pump',
    nextPlaceholder: 'Another pickup point',
    mapTitle: 'Set pickup point',
    noun: 'pickup point',
  },
  dropoff: {
    name: 'dropoffStops',
    title: 'Drop-off points',
    hint: "Where riders get out. Add more if you'll drop off at several spots along the way.",
    icon: 'flag',
    firstPlaceholder: 'Near Karachi Cantt Station',
    nextPlaceholder: 'Another drop-off point',
    mapTitle: 'Set drop-off point',
    noun: 'drop-off point',
  },
} as const;

interface TripStopsSectionProps {
  kind: StopKind;
  control: Control<TripFormValues>;
  setValue: UseFormSetValue<TripFormValues>;
  error?: string;
}

// One card per end of the trip, so pickups and drop-offs never read as one
// list: its own icon, colour and numbered markers (pickup coral, drop-off ink
// — the same split the driver's stop cards use).
export function TripStopsSection({ kind, control, setValue, error }: TripStopsSectionProps) {
  const { colors, spacing, radii } = useTheme();
  const copy = COPY[kind];
  const kindColor = kind === 'pickup' ? colors.primary : colors.text;
  const { fields, append, remove } = useFieldArray({ control, name: copy.name });

  return (
    <AppCard style={{ marginBottom: spacing.md }}>
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: radii.full,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.surfaceAlt,
          }}
        >
          <Ionicons name={copy.icon} size={16} color={kindColor} />
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="label" color={kindColor}>
            {copy.title} <AppText color={colors.danger}>*</AppText>
          </AppText>
          <AppText muted variant="caption" style={{ marginTop: 2 }}>
            {copy.hint}
          </AppText>
        </View>
      </View>

      {fields.map((field, index) => (
        <StopRow
          key={field.id}
          kind={kind}
          index={index}
          isLast={index === fields.length - 1}
          canRemove={fields.length > 1}
          control={control}
          setValue={setValue}
          onRemove={() => remove(index)}
        />
      ))}

      {fields.length < MAX_STOPS ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Add another ${copy.noun}`}
          onPress={() => append({ label: '' })}
          hitSlop={8}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' }}
        >
          <Ionicons name="add-circle-outline" size={18} color={kindColor} />
          <AppText color={kindColor} style={{ fontWeight: '600', fontSize: 13 }}>
            Add {copy.noun}
          </AppText>
        </Pressable>
      ) : null}

      {error ? (
        <AppText variant="caption" color={colors.danger} style={{ marginTop: spacing.sm }}>
          {error}
        </AppText>
      ) : null}
    </AppCard>
  );
}

interface StopRowProps {
  kind: StopKind;
  index: number;
  isLast: boolean;
  canRemove: boolean;
  control: Control<TripFormValues>;
  setValue: UseFormSetValue<TripFormValues>;
  onRemove: () => void;
}

function StopRow({ kind, index, isLast, canRemove, control, setValue, onRemove }: StopRowProps) {
  const { colors, spacing } = useTheme();
  const copy = COPY[kind];
  const markerColor = kind === 'pickup' ? colors.primary : colors.text;
  const markerTextColor = kind === 'pickup' ? colors.primaryText : colors.textInverse;
  const lat = useWatch({ control, name: `${copy.name}.${index}.lat` });
  const lng = useWatch({ control, name: `${copy.name}.${index}.lng` });

  return (
    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
      {/* Numbered marker, with a rail down to the next stop in this section. */}
      <View style={{ width: MARKER_SIZE, alignItems: 'center' }}>
        <View
          style={{
            width: MARKER_SIZE,
            height: MARKER_SIZE,
            marginTop: INPUT_CENTER_OFFSET,
            borderRadius: MARKER_SIZE / 2,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: markerColor,
          }}
        >
          <AppText variant="caption" color={markerTextColor} style={{ fontWeight: '700', fontSize: 12 }}>
            {index + 1}
          </AppText>
        </View>
        {!isLast ? (
          <View style={{ flex: 1, width: 2, marginVertical: spacing.xs, backgroundColor: colors.border }} />
        ) : null}
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <Controller
          control={control}
          name={`${copy.name}.${index}.label`}
          render={({ field, fieldState }) => (
            <LocationField
              placeholder={index === 0 ? copy.firstPlaceholder : copy.nextPlaceholder}
              value={field.value ?? ''}
              onChangeText={field.onChange}
              lat={lat}
              lng={lng}
              onLocationChange={(nextLat, nextLng) => {
                setValue(`${copy.name}.${index}.lat`, nextLat, { shouldDirty: true });
                setValue(`${copy.name}.${index}.lng`, nextLng, { shouldDirty: true });
              }}
              error={fieldState.error?.message}
              regionCodes={REGION_CODES}
              mapTitle={copy.mapTitle}
            />
          )}
        />
      </View>

      {canRemove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${copy.noun} ${index + 1}`}
          onPress={onRemove}
          hitSlop={8}
          style={{ marginTop: INPUT_CENTER_OFFSET, height: MARKER_SIZE, justifyContent: 'center' }}
        >
          <Ionicons name="trash-outline" size={18} color={colors.danger} />
        </Pressable>
      ) : null}
    </View>
  );
}
