import { useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useTheme } from '../../../theme';
import { AppButton, AppInput, AppText } from '../../../components/ui';
import { FilterChipRow } from './FilterChipRow';
import { LocationField } from '../../location/components/LocationField';
import { useCities, useMakes } from '../queries';
import type { ListingFilters } from '../../../api/listings.api';
import { FuelType, Transmission } from '../../../types/enums';
import { DEFAULT_NEARBY_RADIUS_KM, NEARBY_RADIUS_OPTIONS_KM } from '../../../constants/config';

const LOCATION_REGION_CODES = ['PK', 'AE', 'SA'];

const SORT_OPTIONS = [
  { label: 'Newest', value: 'newest' as const },
  { label: 'Price: Low to high', value: 'price_asc' as const },
  { label: 'Price: High to low', value: 'price_desc' as const },
  { label: 'Popular', value: 'popular' as const },
];

const TRANSMISSION_OPTIONS = [
  { label: 'Automatic', value: Transmission.AUTOMATIC },
  { label: 'Manual', value: Transmission.MANUAL },
  { label: 'CVT', value: Transmission.CVT },
];

const FUEL_OPTIONS = [
  { label: 'Petrol', value: FuelType.PETROL },
  { label: 'Diesel', value: FuelType.DIESEL },
  { label: 'Electric', value: FuelType.ELECTRIC },
  { label: 'Hybrid', value: FuelType.HYBRID },
  { label: 'CNG', value: FuelType.CNG },
];

interface FilterSheetProps {
  visible: boolean;
  onClose: () => void;
  filters: ListingFilters;
  onApply: (filters: ListingFilters) => void;
  /** Is a "near me" location (GPS or a previously-applied search) currently active? */
  locationActive: boolean;
  radiusKm: number;
  onApplyRadius: (radiusKm: number) => void;
  onApplyLocation: (lat: number, lng: number) => void;
  onClearLocation: () => void;
}

export function FilterSheet({
  visible,
  onClose,
  filters,
  onApply,
  locationActive,
  radiusKm,
  onApplyRadius,
  onApplyLocation,
  onClearLocation,
}: FilterSheetProps) {
  const { colors, spacing, radii } = useTheme();
  const [draft, setDraft] = useState<ListingFilters>(filters);
  const [draftRadiusKm, setDraftRadiusKm] = useState(radiusKm);
  const [locationText, setLocationText] = useState('');
  const [pendingCoords, setPendingCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locationCleared, setLocationCleared] = useState(false);
  const cities = useCities();
  const makes = useMakes();

  // Reflects what the radius/location section should show right now: either a
  // freshly-picked place in this session, or a location already active from
  // outside the sheet (GPS or an earlier search) that hasn't been cleared here.
  const locationCurrentlySet = pendingCoords !== null || (locationActive && !locationCleared);

  const cityOptions = (cities.data ?? []).map((c) => ({ label: c, value: c }));
  const makeOptions = (makes.data ?? []).map((m) => ({ label: m, value: m }));

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
        <View
          style={{
            backgroundColor: colors.background,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            maxHeight: '85%',
            padding: spacing.lg,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: spacing.md,
            }}
          >
            <AppText variant="subtitle">Filters</AppText>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close filters">
              <AppText variant="subtitle" color={colors.textMuted}>
                ×
              </AppText>
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={{ marginBottom: spacing.lg }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: spacing.xs,
                }}
              >
                <AppText variant="label">Find vehicles near a location</AppText>
                {locationCurrentlySet ? (
                  <Pressable
                    onPress={() => {
                      setPendingCoords(null);
                      setLocationText('');
                      setLocationCleared(true);
                    }}
                  >
                    <AppText variant="caption" color={colors.primary}>
                      Clear
                    </AppText>
                  </Pressable>
                ) : null}
              </View>
              <LocationField
                value={locationText}
                onChangeText={setLocationText}
                onLocationChange={(lat, lng) => {
                  setPendingCoords({ lat, lng });
                  setLocationCleared(false);
                }}
                placeholder="Search a city or area"
                regionCodes={LOCATION_REGION_CODES}
                showMapPicker={false}
              />
            </View>

            {locationCurrentlySet ? (
              <View style={{ marginBottom: spacing.lg }}>
                <AppText variant="label" style={{ marginBottom: spacing.xs }}>
                  Search radius
                </AppText>
                <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
                  {NEARBY_RADIUS_OPTIONS_KM.map((option) => {
                    const selected = option === draftRadiusKm;
                    return (
                      <Pressable
                        key={option}
                        onPress={() => setDraftRadiusKm(option)}
                        style={{
                          paddingHorizontal: spacing.md,
                          paddingVertical: spacing.xs,
                          borderRadius: radii.full,
                          borderWidth: 1,
                          borderColor: selected ? colors.primary : colors.border,
                          backgroundColor: selected ? colors.primary : 'transparent',
                        }}
                      >
                        <AppText variant="caption" color={selected ? colors.primaryText : colors.text}>
                          {option} km
                        </AppText>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            <AppText variant="label" style={{ marginBottom: spacing.xs }}>
              Sort by
            </AppText>
            <FilterChipRow
              options={SORT_OPTIONS}
              value={draft.sort}
              onChange={(sort) => setDraft((d) => ({ ...d, sort }))}
            />

            {cityOptions.length > 0 ? (
              <View style={{ marginTop: spacing.lg }}>
                <AppText variant="label" style={{ marginBottom: spacing.xs }}>
                  City
                </AppText>
                <FilterChipRow
                  options={cityOptions}
                  value={draft.city}
                  onChange={(city) => setDraft((d) => ({ ...d, city }))}
                />
              </View>
            ) : null}

            {makeOptions.length > 0 ? (
              <View style={{ marginTop: spacing.lg }}>
                <AppText variant="label" style={{ marginBottom: spacing.xs }}>
                  Make
                </AppText>
                <FilterChipRow
                  options={makeOptions}
                  value={draft.make}
                  onChange={(make) => setDraft((d) => ({ ...d, make }))}
                />
              </View>
            ) : null}

            <View style={{ marginTop: spacing.lg }}>
              <AppText variant="label" style={{ marginBottom: spacing.xs }}>
                Transmission
              </AppText>
              <FilterChipRow
                options={TRANSMISSION_OPTIONS}
                value={draft.transmission}
                onChange={(transmission) => setDraft((d) => ({ ...d, transmission }))}
              />
            </View>

            <View style={{ marginTop: spacing.lg }}>
              <AppText variant="label" style={{ marginBottom: spacing.xs }}>
                Fuel type
              </AppText>
              <FilterChipRow
                options={FUEL_OPTIONS}
                value={draft.fuelType}
                onChange={(fuelType) => setDraft((d) => ({ ...d, fuelType }))}
              />
            </View>

            <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
              <View style={{ flex: 1 }}>
                <AppInput
                  label="Min price/day"
                  keyboardType="numeric"
                  value={draft.priceMin?.toString() ?? ''}
                  onChangeText={(v) => setDraft((d) => ({ ...d, priceMin: v ? Number(v) : undefined }))}
                />
              </View>
              <View style={{ flex: 1 }}>
                <AppInput
                  label="Max price/day"
                  keyboardType="numeric"
                  value={draft.priceMax?.toString() ?? ''}
                  onChangeText={(v) => setDraft((d) => ({ ...d, priceMax: v ? Number(v) : undefined }))}
                />
              </View>
            </View>

            <AppInput
              label="Minimum seats"
              keyboardType="numeric"
              value={draft.seats?.toString() ?? ''}
              onChangeText={(v) => setDraft((d) => ({ ...d, seats: v ? Number(v) : undefined }))}
            />
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <AppButton
                title="Reset"
                variant="secondary"
                onPress={() => {
                  const cleared: ListingFilters = { search: filters.search };
                  setDraft(cleared);
                  setDraftRadiusKm(DEFAULT_NEARBY_RADIUS_KM);
                  setPendingCoords(null);
                  setLocationText('');
                  setLocationCleared(true);
                }}
              />
            </View>
            <View style={{ flex: 2 }}>
              <AppButton
                title="Apply filters"
                onPress={() => {
                  onApply(draft);
                  onApplyRadius(draftRadiusKm);
                  if (pendingCoords) onApplyLocation(pendingCoords.lat, pendingCoords.lng);
                  else if (locationCleared) onClearLocation();
                  onClose();
                }}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
