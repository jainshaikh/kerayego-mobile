import { Controller, useFieldArray, useWatch, type Control, type UseFormSetValue } from 'react-hook-form';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AppCard, AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';
import { LocationField } from '../../location/components/LocationField';
import type { TripStopFormValue } from '../../../schemas/trip.schema';

type StopKind = 'pickup' | 'dropoff';
type Variant = 'carpool' | 'rental';

/** Any form with a pickup list and a drop-off list of stops — a carpool trip or a rental request. */
export interface StopListFormValues {
  pickupStops: TripStopFormValue[];
  dropoffStops: TripStopFormValue[];
}

const MAX_STOPS = 10;
const REGION_CODES = ['PK', 'AE', 'SA'];
const MARKER_SIZE = 24;
// Centres the marker/remove button on AppInput's 48px-tall box.
const INPUT_CENTER_OFFSET = (48 - MARKER_SIZE) / 2;

const SHARED = {
  pickup: { name: 'pickupStops', title: 'Pickup points', icon: 'radio-button-on', mapTitle: 'Set pickup point', noun: 'pickup point', nextPlaceholder: 'Another pickup point' },
  dropoff: { name: 'dropoffStops', title: 'Drop-off points', icon: 'flag', mapTitle: 'Set drop-off point', noun: 'drop-off point', nextPlaceholder: 'Another drop-off point' },
} as const;

const COPY: Record<Variant, Record<StopKind, { hint: string; firstPlaceholder: string }>> = {
  carpool: {
    pickup: {
      hint: "Where riders get in. Add more if you'll pick up at several spots along the way.",
      firstPlaceholder: 'Liaquatabad Chowrangi, near Total Petrol Pump',
    },
    dropoff: {
      hint: "Where riders get out. Add more if you'll drop off at several spots along the way.",
      firstPlaceholder: 'Near Karachi Cantt Station',
    },
  },
  // A rental request (plan §3c, A75): the driver picks up at the pickups in
  // order, then drops off at the drop-offs in order.
  rental: {
    pickup: {
      hint: 'Where the driver picks you up. Add more if there are several people to collect, in order.',
      firstPlaceholder: 'e.g. Qasimabad, Hyderabad',
    },
    dropoff: {
      hint: 'Where the trip goes. Add more if there are several places to drop off, in order.',
      firstPlaceholder: 'e.g. Larkana Bypass',
    },
  },
};

interface TripStopsSectionProps<T extends StopListFormValues> {
  kind: StopKind;
  control: Control<T>;
  setValue: UseFormSetValue<T>;
  error?: string;
  // 'rental' — the request sheet's wording, and typing in a place clears the
  // coordinates a pick gave it (a rental stop must be picked, A75).
  variant?: Variant;
  // Replaces the card's hint line (e.g. a weekly rental's "where the car is handed back").
  hint?: string;
  // How many stops this card may hold (rental: what's left of 10 in all). Default 10.
  maxStops?: number;
}

// One card per end of the trip, so pickups and drop-offs never read as one
// list: its own icon, colour and numbered markers (pickup coral, drop-off ink
// — the same split the driver's stop cards use).
export function TripStopsSection<T extends StopListFormValues>({
  kind,
  control: anyControl,
  setValue: anySetValue,
  error,
  variant = 'carpool',
  hint,
  maxStops = MAX_STOPS,
}: TripStopsSectionProps<T>) {
  // React Hook Form's types can't follow the stop paths through a generic
  // form type; every form passed here has the two stop lists, so the section
  // works on that shape.
  const control = anyControl as unknown as Control<StopListFormValues>;
  const setValue = anySetValue as unknown as UseFormSetValue<StopListFormValues>;
  const { colors, spacing, radii } = useTheme();
  const copy = { ...SHARED[kind], ...COPY[variant][kind] };
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
            {hint ?? copy.hint}
          </AppText>
        </View>
      </View>

      {fields.map((field, index) => (
        <StopRow
          key={field.id}
          kind={kind}
          variant={variant}
          index={index}
          isLast={index === fields.length - 1}
          canRemove={fields.length > 1}
          control={control}
          setValue={setValue}
          onRemove={() => remove(index)}
        />
      ))}

      {fields.length < maxStops ? (
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
  variant: Variant;
  index: number;
  isLast: boolean;
  canRemove: boolean;
  control: Control<StopListFormValues>;
  setValue: UseFormSetValue<StopListFormValues>;
  onRemove: () => void;
}

function StopRow({ kind, variant, index, isLast, canRemove, control, setValue, onRemove }: StopRowProps) {
  const { colors, spacing } = useTheme();
  const copy = { ...SHARED[kind], ...COPY[variant][kind] };
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
              onChangeText={(text) => {
                field.onChange(text);
                // A rental stop must be picked (A75): typing drops the old
                // pick's coordinates. Picking a suggestion or a map spot sets
                // the text first, then the new coordinates.
                if (variant === 'rental') {
                  setValue(`${copy.name}.${index}.lat`, undefined);
                  setValue(`${copy.name}.${index}.lng`, undefined);
                }
              }}
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
