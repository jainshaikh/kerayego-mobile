import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useTheme } from '../../../theme';
import { AppButton, AppInput, AppSheet, AppText, DateField } from '../../../components/ui';
import { FilterChipRow } from '../../listings/components/FilterChipRow';
import { useTripCities } from '../queries';
import type { TripFilters } from '../../../api/trips.api';

const SORT_OPTIONS = [
  { label: 'Soonest departure', value: 'departure_asc' as const },
  { label: 'Newest', value: 'newest' as const },
  { label: 'Price: Low to high', value: 'price_asc' as const },
  { label: 'Price: High to low', value: 'price_desc' as const },
];

interface TripFilterSheetProps {
  visible: boolean;
  onClose: () => void;
  filters: TripFilters;
  onApply: (filters: TripFilters) => void;
}

export function TripFilterSheet({ visible, onClose, filters, onApply }: TripFilterSheetProps) {
  const { spacing } = useTheme();
  const [draft, setDraft] = useState<TripFilters>(filters);
  const [departureDate, setDepartureDate] = useState<Date | undefined>(
    filters.date ? new Date(`${filters.date}T00:00:00`) : undefined,
  );
  const cities = useTripCities();

  const originOptions = (cities.data?.origins ?? []).map((c) => ({ label: c, value: c }));
  const destinationOptions = (cities.data?.destinations ?? []).map((c) => ({ label: c, value: c }));

  return (
    <AppSheet visible={visible} onClose={onClose} title="Filter trips">
      <ScrollView showsVerticalScrollIndicator={false}>
        <AppText variant="label" style={{ marginBottom: spacing.xs }}>
          Sort by
        </AppText>
        <FilterChipRow options={SORT_OPTIONS} value={draft.sort} onChange={(sort) => setDraft((d) => ({ ...d, sort }))} />

        {originOptions.length > 0 ? (
          <View style={{ marginTop: spacing.lg }}>
            <AppText variant="label" style={{ marginBottom: spacing.xs }}>
              From
            </AppText>
            <FilterChipRow
              options={originOptions}
              value={draft.originCity}
              onChange={(originCity) => setDraft((d) => ({ ...d, originCity }))}
            />
          </View>
        ) : null}

        {destinationOptions.length > 0 ? (
          <View style={{ marginTop: spacing.lg }}>
            <AppText variant="label" style={{ marginBottom: spacing.xs }}>
              To
            </AppText>
            <FilterChipRow
              options={destinationOptions}
              value={draft.destinationCity}
              onChange={(destinationCity) => setDraft((d) => ({ ...d, destinationCity }))}
            />
          </View>
        ) : null}

        <View style={{ marginTop: spacing.md }}>
          <DateField
            label="Departure date (optional)"
            value={departureDate}
            minimumDate={new Date()}
            onChange={(date) => {
              setDepartureDate(date);
              setDraft((d) => ({ ...d, date: date.toISOString().slice(0, 10) }));
            }}
          />
        </View>

        <AppInput
          label="Minimum seats"
          keyboardType="numeric"
          value={draft.minSeats?.toString() ?? ''}
          onChangeText={(v) => setDraft((d) => ({ ...d, minSeats: v ? Number(v) : undefined }))}
        />
      </ScrollView>

      <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <AppButton
            title="Reset"
            variant="secondary"
            onPress={() => {
              setDraft({});
              setDepartureDate(undefined);
            }}
          />
        </View>
        <View style={{ flex: 2 }}>
          <AppButton
            title="Apply filters"
            onPress={() => {
              onApply(draft);
              onClose();
            }}
          />
        </View>
      </View>
    </AppSheet>
  );
}
