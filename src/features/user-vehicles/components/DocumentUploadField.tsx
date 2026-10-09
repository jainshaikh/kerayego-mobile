import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '../../../theme';
import { AppText } from '../../../components/ui';
import { pickAndUploadImage } from '../../media/useImagePicker';
import { normalizeApiError } from '../../../api/errors';
import type { UploadedDoc } from '../userVehicleDraft';

export type { UploadedDoc };

interface DocumentUploadFieldProps {
  label: string;
  value: UploadedDoc | null;
  onChange: (doc: UploadedDoc) => void;
  entityId?: string; // groups this upload into the owning vehicle's S3 folder
  // True from the tap until the upload settles (picker included), so the form
  // can hold its submit button — otherwise a file still uploading is left out.
  onUploadingChange?: (uploading: boolean) => void;
  // Edit mode: the file on record was rejected in review and hasn't been replaced yet.
  rejected?: boolean;
  // One line under the field — the rejection reason when `rejected`, else a hint.
  note?: string | null;
}

// Shared by the personal-vehicle form (CNIC / driving license / vehicle
// registration) — uploads via /media/upload?context=trip_document, same plumbing
// used for provider vehicle photos, just a different context.
export function DocumentUploadField({
  label,
  value,
  onChange,
  entityId,
  onUploadingChange,
  rejected = false,
  note,
}: DocumentUploadFieldProps) {
  const { colors, radii, spacing } = useTheme();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A promise chain rather than try/finally, which the React Compiler can't compile.
  const handlePick = () => {
    setError(null);
    setUploading(true);
    onUploadingChange?.(true);
    pickAndUploadImage('trip_document', undefined, entityId)
      .then((uploaded) => {
        if (uploaded) onChange({ url: uploaded.url, publicId: uploaded.publicId });
      })
      .catch((e: unknown) => setError(normalizeApiError(e).message))
      .finally(() => {
        setUploading(false);
        onUploadingChange?.(false);
      });
  };

  const tint = rejected ? colors.danger : value ? colors.success : colors.primary;

  return (
    <View style={{ marginBottom: spacing.md }}>
      <AppText variant="label" style={{ marginBottom: spacing.xs }}>
        {label}
      </AppText>
      <Pressable
        onPress={handlePick}
        disabled={uploading}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${rejected ? 'rejected, replace' : value ? 'replace' : 'upload'}`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          borderWidth: 1,
          borderColor: rejected ? colors.danger : value ? colors.success : colors.border,
          borderRadius: radii.md,
          padding: spacing.sm,
        }}
      >
        {value ? (
          <Image source={{ uri: value.url }} style={{ width: 56, height: 42, borderRadius: radii.sm, marginRight: spacing.md }} contentFit="cover" />
        ) : null}
        <AppText color={tint} variant="label">
          {uploading
            ? 'Uploading...'
            : rejected
              ? 'Not accepted — tap to replace'
              : value
                ? 'Uploaded — tap to replace'
                : 'Upload photo'}
        </AppText>
      </Pressable>
      {error ? (
        <AppText variant="caption" color={colors.danger} style={{ marginTop: spacing.xs }}>
          {error}
        </AppText>
      ) : note ? (
        <AppText variant="caption" muted color={rejected ? colors.danger : undefined} style={{ marginTop: spacing.xs }}>
          {note}
        </AppText>
      ) : null}
    </View>
  );
}
