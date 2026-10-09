import { useState } from 'react';
import { View } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { AppButton, AppInput, AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';
import { DocumentStatus } from '../../../types/enums';
import type { UserVehicleDocument, UserVehicleDocumentType } from '../../../types/api.types';
import type { UserVehicleImageInput } from '../../../api/user-vehicles.api';
import { userVehicleFormSchema, type UserVehicleFormValues } from '../../../schemas/user-vehicle.schema';
import {
  USER_VEHICLE_DOCUMENT_LABELS,
  USER_VEHICLE_DOCUMENT_TYPES,
  emptyUserVehicleDocuments,
  missingDocumentTypes,
  type UploadedDoc,
  type UserVehicleDocuments,
  type UserVehicleDraft,
} from '../userVehicleDraft';
import { DocumentUploadField } from './DocumentUploadField';
import { VehiclePhotosField } from './VehiclePhotosField';

interface UserVehicleFormProps {
  mode: 'create' | 'edit';
  // The vehicle's id. Every photo/document lands in its own S3 folder
  // (user-vehicles/{id}/...), which the backend checks: a fresh client-generated
  // id when registering, the existing vehicle's id when editing.
  entityId: string;
  // Edit mode: the vehicle as it is now (draftFromVehicle).
  initialDraft?: UserVehicleDraft;
  // Edit mode: the vehicle's current documents, for their review state.
  currentDocuments?: Partial<Record<UserVehicleDocumentType, UserVehicleDocument>>;
  submitLabel: string;
  submitting: boolean;
  error: string | null;
  onSubmit: (draft: UserVehicleDraft) => void;
}

// The personal-vehicle form shared by "Register vehicle" and "Edit vehicle":
// the same fields, validation and upload plumbing. It only collects the draft;
// each screen turns it into its own request (userVehicleDraft.ts).
export function UserVehicleForm({
  mode,
  entityId,
  initialDraft,
  currentDocuments,
  submitLabel,
  submitting,
  error,
  onSubmit,
}: UserVehicleFormProps) {
  const { spacing, colors } = useTheme();
  const [photos, setPhotos] = useState<UserVehicleImageInput[]>(initialDraft?.photos ?? []);
  const [documents, setDocuments] = useState<UserVehicleDocuments>(
    initialDraft?.documents ?? emptyUserVehicleDocuments(),
  );
  // Which pickers have an upload in flight ('photos' or a document type).
  const [uploading, setUploading] = useState<Record<string, boolean>>({});

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<UserVehicleFormValues>({
    resolver: zodResolver(userVehicleFormSchema),
    defaultValues: initialDraft?.values,
  });

  const missing = missingDocumentTypes(documents);
  const uploadInFlight = Object.values(uploading).some(Boolean);

  const trackUpload = (key: string) => (value: boolean) => setUploading((prev) => ({ ...prev, [key]: value }));
  const setDocument = (type: UserVehicleDocumentType) => (doc: UploadedDoc) =>
    setDocuments((prev) => ({ ...prev, [type]: doc }));

  // Edit mode: a document still holding the file our team rejected is flagged
  // with the reason; one replaced in this edit says it'll be reviewed again.
  const documentReview = (type: UserVehicleDocumentType) => {
    if (mode !== 'edit') return { rejected: false, note: null };
    const current = currentDocuments?.[type];
    const value = documents[type];
    if (value && value.publicId !== current?.publicId) {
      return { rejected: false, note: 'New file — our team reviews it after you save.' };
    }
    if (current?.status === DocumentStatus.REJECTED) {
      return { rejected: true, note: current.rejectionReason ?? "Our team couldn't accept this document." };
    }
    return { rejected: false, note: null };
  };

  return (
    <View>
      <Controller
        control={control}
        name="make"
        render={({ field }) => (
          <AppInput label="Make" placeholder="Toyota" value={field.value} onChangeText={field.onChange} error={errors.make?.message} />
        )}
      />
      <Controller
        control={control}
        name="model"
        render={({ field }) => (
          <AppInput label="Model" placeholder="Corolla" value={field.value} onChangeText={field.onChange} error={errors.model?.message} />
        )}
      />
      <Controller
        control={control}
        name="year"
        render={({ field }) => (
          <AppInput
            label="Year (optional)"
            keyboardType="numeric"
            value={field.value?.toString() ?? ''}
            onChangeText={(v) => field.onChange(v ? Number(v) : undefined)}
            error={errors.year?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="color"
        render={({ field }) => (
          <AppInput label="Color (optional)" placeholder="White" value={field.value} onChangeText={field.onChange} error={errors.color?.message} />
        )}
      />
      <Controller
        control={control}
        name="plateNumber"
        render={({ field }) => (
          <AppInput label="Plate number" placeholder="ABC-123" value={field.value} onChangeText={field.onChange} error={errors.plateNumber?.message} />
        )}
      />

      <VehiclePhotosField entityId={entityId} images={photos} onChange={setPhotos} onUploadingChange={trackUpload('photos')} />

      <AppText variant="label" style={{ marginTop: spacing.md, marginBottom: spacing.sm }}>
        Verification documents
      </AppText>
      {USER_VEHICLE_DOCUMENT_TYPES.map((type) => {
        const review = documentReview(type);
        return (
          <DocumentUploadField
            key={type}
            label={USER_VEHICLE_DOCUMENT_LABELS[type]}
            value={documents[type]}
            onChange={setDocument(type)}
            entityId={entityId}
            onUploadingChange={trackUpload(type)}
            rejected={review.rejected}
            note={review.note}
          />
        );
      })}

      {missing.length > 0 ? (
        <AppText muted variant="caption" style={{ marginBottom: spacing.md }}>
          Upload all four documents to continue.
        </AppText>
      ) : null}

      {error ? (
        <AppText accessibilityRole="alert" color={colors.danger} style={{ marginBottom: spacing.md }}>
          {error}
        </AppText>
      ) : null}

      <AppButton
        title={submitLabel}
        loading={submitting}
        disabled={missing.length > 0 || uploadInFlight}
        onPress={handleSubmit((values) => onSubmit({ values, photos, documents }))}
      />
    </View>
  );
}
