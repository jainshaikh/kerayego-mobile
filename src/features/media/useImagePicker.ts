import * as ImagePicker from 'expo-image-picker';
import { mediaApi, type UploadContext } from '../../api/media.api';
import type { UploadResult } from '../../types/api.types';

/** Requests photo-library permission only when the user actually initiates a pick — never earlier. */
export async function pickAndUploadImage(
  context: UploadContext,
  documentType?: string,
  // Client-generated id of the entity these files belong to (e.g. a vehicle being
  // drafted before it's created) — groups uploads into a per-entity storage folder.
  entityId?: string,
): Promise<UploadResult | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.85,
  });

  if (result.canceled || result.assets.length === 0) return null;

  const asset = result.assets[0];
  const uploaded = await mediaApi.upload(
    {
      uri: asset.uri,
      name: asset.fileName ?? `upload-${Date.now()}.jpg`,
      type: asset.mimeType ?? 'image/jpeg',
    },
    context,
    documentType,
    entityId,
  );

  return uploaded;
}
