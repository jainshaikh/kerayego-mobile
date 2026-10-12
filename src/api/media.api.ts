import apiClient from './client';
import type { ApiResponse, UploadResult } from '../types/api.types';

export type UploadContext = 'document' | 'trip_document' | 'user_vehicle_photo';

export const DOCUMENT_TYPES = [
  { value: 'BUSINESS_LICENSE', label: 'Business License' },
  { value: 'TRADE_LICENSE', label: 'Trade License' },
  { value: 'OWNERSHIP_PROOF', label: 'Ownership Proof' },
  { value: 'ID_DOCUMENT', label: 'ID Document' },
  { value: 'VEHICLE_REGISTRATION', label: 'Vehicle Registration' },
  { value: 'VEHICLE_INSURANCE', label: 'Vehicle Insurance' },
  { value: 'OTHER', label: 'Other Document' },
] as const;

// Shape returned by expo-image-picker / expo-document-picker results — RN's FormData
// takes a { uri, name, type } object in place of a web File/Blob.
export interface LocalFile {
  uri: string;
  name: string;
  type: string;
}

export const mediaApi = {
  upload: async (
    file: LocalFile,
    context: UploadContext,
    documentType?: string,
    // Client-generated id of the entity these files belong to (e.g. a vehicle being
    // drafted before it's created) — groups uploads into a per-entity S3 folder.
    entityId?: string,
    onProgress?: (percent: number) => void,
  ): Promise<UploadResult> => {
    const formData = new FormData();
    // React Native's FormData accepts this file-descriptor shape directly.
    formData.append('file', file as unknown as Blob);

    const params = new URLSearchParams({ context });
    if (documentType) params.set('documentType', documentType);
    if (entityId) params.set('entityId', entityId);

    const res = await apiClient.post<ApiResponse<UploadResult>>(`/media/upload?${params.toString()}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (event) => {
        if (onProgress && event.total) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      },
    });

    return res.data.data;
  },
};
