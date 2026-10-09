import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { useUpdateUserVehicle, useUserVehicle } from '../../../../features/user-vehicles/queries';
import { UserVehicleForm } from '../../../../features/user-vehicles/components/UserVehicleForm';
import {
  buildUpdatePayload,
  describeVehicleSaveError,
  documentsByType,
  draftFromVehicle,
  isEmptyUpdate,
  type UserVehicleDraft,
} from '../../../../features/user-vehicles/userVehicleDraft';
import type { UpdateUserVehiclePayload } from '../../../../api/user-vehicles.api';
import { normalizeApiError } from '../../../../api/errors';
import {
  AppButton,
  AppCard,
  AppScreen,
  AppSheet,
  AppText,
  EmptyState,
  ErrorState,
  LoadingState,
  StatusBadge,
} from '../../../../components/ui';
import { useTheme } from '../../../../theme';
import { canOwnerEditUserVehicle, UserVehicleStatus, userVehicleStatusMeta } from '../../../../types/enums';
import { titleCase } from '../../../../utils/format';

// Edit a REJECTED or PENDING_REVIEW personal vehicle and (re)submit it — every
// successful save puts it (back) under review. New photos/documents upload into
// the vehicle's own folder (entityId = its id), and only what changed is sent.
export default function EditUserVehicleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, spacing, tones } = useTheme();
  const { data: vehicle, isError, refetch } = useUserVehicle(id);
  const updateVehicle = useUpdateUserVehicle(id);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmUnchanged, setConfirmUnchanged] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // A failed background refetch (e.g. after a 409) keeps the loaded vehicle —
  // and with it the draft — on screen; only a first load that failed is an error.
  if (!vehicle) {
    return isError ? (
      <ErrorState message="Couldn't load this vehicle." onRetry={refetch} />
    ) : (
      <LoadingState label="Loading vehicle..." />
    );
  }

  const backToVehicle = () => {
    if (router.canGoBack()) router.back();
    else router.replace(`/account/my-vehicles/${vehicle.id}`);
  };

  const statusMeta = userVehicleStatusMeta[vehicle.status];

  if (!canOwnerEditUserVehicle(vehicle.status)) {
    return (
      <EmptyState
        title="This vehicle can't be edited"
        description={`It's ${statusMeta.label.toLowerCase()} — only a vehicle that is under review or wasn't approved can be changed.`}
        actionLabel="Back to vehicle"
        onAction={backToVehicle}
      />
    );
  }

  const isRejected = vehicle.status === UserVehicleStatus.REJECTED;

  // Resolves to the message to show, or null once saved.
  const save = async (payload: UpdateUserVehiclePayload): Promise<string | null> => {
    try {
      await updateVehicle.mutateAsync(payload);
      return null;
    } catch (error) {
      const failure = describeVehicleSaveError(normalizeApiError(error));
      if (failure.refetchVehicle) void refetch();
      return failure.message;
    }
  };

  const onSubmit = async (draft: UserVehicleDraft) => {
    setFormError(null);
    const payload = buildUpdatePayload(vehicle, draft);
    if (!isEmptyUpdate(payload)) {
      const message = await save(payload);
      if (message) setFormError(message);
      else backToVehicle();
      return;
    }
    // An empty PATCH resubmits a rejected vehicle as it is — worth a second
    // look first. Under review there's nothing to send, and sending anyway
    // would only move it to the back of the review queue.
    if (isRejected) {
      setConfirmError(null);
      setConfirmUnchanged(true);
    } else {
      setFormError("You haven't changed anything yet.");
    }
  };

  const resubmitUnchanged = async () => {
    setConfirmError(null);
    const message = await save({});
    if (message) {
      setConfirmError(message);
      return;
    }
    setConfirmUnchanged(false);
    backToVehicle();
  };

  return (
    <AppScreen scroll keyboardAvoiding contentContainerStyle={{ padding: spacing.lg }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md }}>
        <AppText variant="subtitle" style={{ flex: 1, marginRight: spacing.sm }}>
          {titleCase(vehicle.make)} {titleCase(vehicle.model)}
        </AppText>
        <StatusBadge label={statusMeta.label} tone={statusMeta.tone} />
      </View>

      {isRejected ? (
        <AppCard style={{ marginBottom: spacing.lg, backgroundColor: tones.danger.bg, borderColor: colors.danger }}>
          <AppText variant="label" color={tones.danger.fg}>
            Why it wasn&apos;t approved
          </AppText>
          <AppText color={tones.danger.fg} style={{ marginTop: spacing.xs }}>
            {vehicle.rejectionReason ?? "Our team didn't give a reason."}
          </AppText>
          <AppText variant="caption" color={tones.danger.fg} style={{ marginTop: spacing.sm }}>
            Fix what&apos;s needed below, then resubmit — our team reviews it again.
          </AppText>
        </AppCard>
      ) : (
        <AppText muted style={{ marginBottom: spacing.lg }}>
          Your vehicle is still under review. Saving changes sends the updated vehicle back to the end of the review
          queue.
        </AppText>
      )}

      <UserVehicleForm
        key={vehicle.id}
        mode="edit"
        entityId={vehicle.id}
        initialDraft={draftFromVehicle(vehicle)}
        currentDocuments={documentsByType(vehicle.documents)}
        submitLabel={isRejected ? 'Save & resubmit' : 'Save changes'}
        submitting={updateVehicle.isPending && !confirmUnchanged}
        error={formError}
        onSubmit={onSubmit}
      />

      <AppSheet
        visible={confirmUnchanged}
        onClose={() => setConfirmUnchanged(false)}
        title="Resubmit without changes?"
      >
        <AppText muted variant="caption" style={{ marginBottom: spacing.md }}>
          You haven&apos;t changed any details, photos or documents, so our team will review exactly the same vehicle
          again. Make sure the reason it wasn&apos;t approved no longer applies.
        </AppText>
        {confirmError ? (
          <AppText color={colors.danger} variant="caption" style={{ marginBottom: spacing.md }}>
            {confirmError}
          </AppText>
        ) : null}
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <AppButton title="Keep editing" variant="secondary" onPress={() => setConfirmUnchanged(false)} />
          </View>
          <View style={{ flex: 1 }}>
            <AppButton title="Resubmit" loading={updateVehicle.isPending} onPress={resubmitUnchanged} />
          </View>
        </View>
      </AppSheet>
    </AppScreen>
  );
}
