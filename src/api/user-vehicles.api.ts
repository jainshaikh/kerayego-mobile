import apiClient from './client';
import type { ApiResponse, UserVehicle, UserVehicleDetail, UserVehicleDocumentType } from '../types/api.types';
import type { Market } from '../types/enums';

export interface UserVehicleImageInput {
  url: string;
  publicId: string;
  altText?: string;
  width?: number;
  height?: number;
}

export interface CreateUserVehiclePayload {
  // Client-generated id (required by the backend) — photo/document uploads land
  // in this vehicle's own S3 folder (user-vehicles/{id}/...) before the record
  // exists, and the backend refuses any file from outside that folder.
  id: string;
  make: string;
  model: string;
  year?: number;
  color?: string;
  plateNumber: string;
  country?: Market; // backend defaults to PK
  images?: UserVehicleImageInput[];
  cnicFrontUrl: string;
  cnicFrontPublicId: string;
  cnicBackUrl: string;
  cnicBackPublicId: string;
  drivingLicenseUrl: string;
  drivingLicensePublicId: string;
  vehicleRegistrationUrl: string;
  vehicleRegistrationPublicId: string;
}

export interface UserVehicleDocumentInput {
  documentType: UserVehicleDocumentType;
  // Both exactly as /media/upload returned them.
  url: string;
  publicId: string;
}

// PATCH /my/vehicles/:id (UpdateUserVehicleDto) — every field optional, only
// what's sent changes. Never send `id` or the create-style flat document
// fields: both are 400 (forbidNonWhitelisted).
export interface UpdateUserVehiclePayload {
  make?: string;
  model?: string;
  // null clears the (nullable) column: the DTO's @IsOptional lets null through.
  year?: number | null;
  color?: string | null;
  plateNumber?: string;
  country?: Market;
  // The COMPLETE new photo list in display order (first = poster); photos left
  // out are removed. A photo already on the vehicle is recognised by publicId;
  // a new one must have been uploaded with entityId = this vehicle's id.
  images?: UserVehicleImageInput[];
  // Replacements only, at most one per type; types not sent keep their file.
  // A replaced document goes back to PENDING review.
  documents?: UserVehicleDocumentInput[];
}

// Personal vehicles — registered by any USER or PROVIDER, verified once by an
// admin, then reusable across any number of posted Trips.
export const userVehiclesApi = {
  create: async (data: CreateUserVehiclePayload) => {
    const res = await apiClient.post<ApiResponse<UserVehicle>>('/my/vehicles', data);
    return res.data.data;
  },

  getMine: async () => {
    // Bare array response — this endpoint isn't paginated.
    const res = await apiClient.get<ApiResponse<UserVehicle[]>>('/my/vehicles');
    return res.data.data;
  },

  getApproved: async () => {
    const res = await apiClient.get<ApiResponse<UserVehicle[]>>('/my/vehicles/approved');
    return res.data.data;
  },

  getOne: async (id: string) => {
    const res = await apiClient.get<ApiResponse<UserVehicleDetail>>(`/my/vehicles/${id}`);
    return res.data.data;
  },

  // Edits a REJECTED or PENDING_REVIEW vehicle and (re)submits it: it comes
  // back PENDING_REVIEW with rejectionReason cleared, in GET :id's shape. 409
  // for an APPROVED/SUSPENDED vehicle or one that changed meanwhile, 400 for a
  // file that isn't this vehicle's own upload. Backends that predate the
  // endpoint answer 404.
  update: async (id: string, data: UpdateUserVehiclePayload) => {
    const res = await apiClient.patch<ApiResponse<UserVehicleDetail>>(`/my/vehicles/${id}`, data);
    return res.data.data;
  },
};
