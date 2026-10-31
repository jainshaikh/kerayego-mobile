import { useState } from 'react';
import { router } from 'expo-router';

import { useCreateTrip } from '../../../features/trips/queries';
import { TripForm } from '../../../features/trips/components/TripForm';
import { normalizeApiError } from '../../../api/errors';
import { IdentityHoldBanner } from '../../../features/identity/components/IdentityHoldBanner';
import { useIdentityHold } from '../../../features/identity/useIdentityHold';
import { AppScreen, AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';
import type { TripFormValues } from '../../../schemas/trip.schema';

export default function NewTripScreen() {
  const { spacing, colors } = useTheme();
  const createTrip = useCreateTrip();
  const [formError, setFormError] = useState<string | null>(null);
  const hold = useIdentityHold();

  const handleSubmit = async (values: TripFormValues) => {
    setFormError(null);
    try {
      const firstPickup = values.pickupStops?.[0];
      const lastDropoff = values.dropoffStops?.[values.dropoffStops.length - 1];

      await createTrip.mutateAsync({
        userVehicleId: values.userVehicleId,
        originCity: values.originCity,
        destinationCity: values.destinationCity,
        pickupStops: values.pickupStops,
        dropoffStops: values.dropoffStops,
        pickupPoint: values.pickupPoint || firstPickup?.label,
        pickupLat: values.pickupLat ?? firstPickup?.lat,
        pickupLng: values.pickupLng ?? firstPickup?.lng,
        dropoffPoint: values.dropoffPoint || lastDropoff?.label,
        dropoffLat: values.dropoffLat ?? lastDropoff?.lat,
        dropoffLng: values.dropoffLng ?? lastDropoff?.lng,
        departureAt: values.departureAt.toISOString(),
        availableSeats: values.availableSeats,
        pricePerSeat: values.pricePerSeat,
        contactNumber: values.contactNumber,
        notes: values.notes || undefined,
      });
      router.replace('/account/my-trips');
    } catch (error) {
      const normalized = normalizeApiError(error);
      // On hold: the banner shows the server's message instead.
      if (hold.handleHoldError(normalized)) return;
      setFormError(normalized.message);
    }
  };

  return (
    <AppScreen scroll keyboardAvoiding contentContainerStyle={{ padding: spacing.lg }}>
      <AppText muted style={{ marginBottom: spacing.lg }}>
        Your trip goes live immediately once posted.
      </AppText>

      <IdentityHoldBanner message={hold.notice} />

      {formError ? (
        <AppText color={colors.danger} style={{ marginBottom: spacing.md }}>
          {formError}
        </AppText>
      ) : null}

      <TripForm submitLabel="Post trip" submitting={createTrip.isPending} onSubmit={handleSubmit} />
    </AppScreen>
  );
}
