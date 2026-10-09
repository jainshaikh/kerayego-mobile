import { useState } from 'react';
import { router } from 'expo-router';
import * as Crypto from 'expo-crypto';

import { useCreateUserVehicle } from '../../../features/user-vehicles/queries';
import { UserVehicleForm } from '../../../features/user-vehicles/components/UserVehicleForm';
import { buildCreatePayload, type UserVehicleDraft } from '../../../features/user-vehicles/userVehicleDraft';
import { normalizeApiError } from '../../../api/errors';
import { AppScreen, AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';

export default function RegisterUserVehicleScreen() {
  const { spacing } = useTheme();
  const createVehicle = useCreateUserVehicle();
  const [formError, setFormError] = useState<string | null>(null);

  // Generated once, before the vehicle exists server-side, so every upload for this
  // form (photos + documents) lands in the same per-vehicle S3 folder. Sent as the
  // record's id when the form is finally submitted — the backend requires it.
  const [vehicleId] = useState(() => Crypto.randomUUID());

  const onSubmit = async (draft: UserVehicleDraft) => {
    setFormError(null);
    const payload = buildCreatePayload(vehicleId, draft);
    if (!payload) {
      setFormError('Please upload all four documents before submitting.');
      return;
    }
    try {
      await createVehicle.mutateAsync(payload);
      router.back();
    } catch (error) {
      setFormError(normalizeApiError(error).message);
    }
  };

  return (
    <AppScreen scroll keyboardAvoiding contentContainerStyle={{ padding: spacing.lg }}>
      <AppText muted style={{ marginBottom: spacing.lg }}>
        Register your vehicle once — an admin verifies your documents, then you can reuse this vehicle for any number of
        trips.
      </AppText>

      <UserVehicleForm
        mode="create"
        entityId={vehicleId}
        submitLabel="Submit for verification"
        submitting={createVehicle.isPending}
        error={formError}
        onSubmit={onSubmit}
      />
    </AppScreen>
  );
}
