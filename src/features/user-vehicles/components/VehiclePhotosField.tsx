import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '../../../theme';
import { AppText } from '../../../components/ui';
import { pickAndUploadImage } from '../../media/useImagePicker';
import { normalizeApiError } from '../../../api/errors';
import type { UserVehicleImageInput } from '../../../api/user-vehicles.api';

const MAX_PHOTOS = 6;

interface VehiclePhotosFieldProps {
  // The vehicle's id (client-generated when registering, the existing id when
  // editing) — every photo lands in its user-vehicles/{id}/photos/ folder.
  entityId: string;
  images: UserVehicleImageInput[];
  onChange: (images: UserVehicleImageInput[]) => void;
  // True while a photo is being picked/uploaded, so the form can hold submit.
  onUploadingChange?: (uploading: boolean) => void;
}

// First image is the poster/cover shown as the card thumbnail and trip detail hero.
export function VehiclePhotosField({ entityId, images, onChange, onUploadingChange }: VehiclePhotosFieldProps) {
  const { colors, radii, spacing } = useTheme();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A promise chain rather than try/finally, which the React Compiler can't compile.
  const handleAdd = () => {
    setError(null);
    setUploading(true);
    onUploadingChange?.(true);
    pickAndUploadImage('user_vehicle_photo', undefined, entityId)
      .then((uploaded) => {
        if (uploaded) onChange([...images, { url: uploaded.url, publicId: uploaded.publicId, width: uploaded.width, height: uploaded.height }]);
      })
      .catch((e: unknown) => setError(normalizeApiError(e).message))
      .finally(() => {
        setUploading(false);
        onUploadingChange?.(false);
      });
  };

  const removeAt = (index: number) => {
    onChange(images.filter((_, i) => i !== index));
  };

  return (
    <View style={{ marginBottom: spacing.md }}>
      <AppText variant="label" style={{ marginBottom: spacing.xs }}>
        Vehicle photos
      </AppText>
      <AppText muted variant="caption" style={{ marginBottom: spacing.sm }}>
        First photo is the poster shown on trip cards.
      </AppText>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {images.map((image, index) => (
          <View key={image.publicId} style={{ width: 80, height: 80, borderRadius: radii.md, overflow: 'hidden' }}>
            <Image source={{ uri: image.url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
            {index === 0 ? (
              <View
                style={{
                  position: 'absolute',
                  left: 4,
                  top: 4,
                  backgroundColor: 'rgba(0,0,0,0.6)',
                  borderRadius: 4,
                  paddingHorizontal: 4,
                  paddingVertical: 1,
                }}
              >
                <AppText variant="caption" color="#fff" style={{ fontSize: 10 }}>
                  Poster
                </AppText>
              </View>
            ) : null}
            <Pressable
              onPress={() => removeAt(index)}
              style={{
                position: 'absolute',
                right: 4,
                top: 4,
                backgroundColor: 'rgba(0,0,0,0.6)',
                borderRadius: 10,
                width: 18,
                height: 18,
                alignItems: 'center',
                justifyContent: 'center',
              }}
              accessibilityRole="button"
              accessibilityLabel="Remove photo"
            >
              <AppText variant="caption" color="#fff" style={{ fontSize: 12, lineHeight: 14 }}>
                ×
              </AppText>
            </Pressable>
          </View>
        ))}

        {images.length < MAX_PHOTOS ? (
          <Pressable
            onPress={handleAdd}
            disabled={uploading}
            style={{
              width: 80,
              height: 80,
              borderRadius: radii.md,
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: colors.border,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: uploading ? 0.6 : 1,
            }}
          >
            <AppText variant="caption" muted>
              {uploading ? '...' : '+ Add'}
            </AppText>
          </Pressable>
        ) : null}
      </View>

      {error ? (
        <AppText variant="caption" color={colors.danger} style={{ marginTop: spacing.xs }}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
}
