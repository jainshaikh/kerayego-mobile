import type { NormalizedApiError } from '../../api/errors';
import type {
  CreateUserVehiclePayload,
  UpdateUserVehiclePayload,
  UserVehicleDocumentInput,
  UserVehicleImageInput,
} from '../../api/user-vehicles.api';
import type { UserVehicleFormValues } from '../../schemas/user-vehicle.schema';
import type {
  UserVehicleDetail,
  UserVehicleDocument,
  UserVehicleDocumentType,
  UserVehicleImage,
} from '../../types/api.types';
import { DocumentStatus, UserVehicleStatus, type StatusTone } from '../../types/enums';

// Pure logic behind the personal-vehicle form (register + edit/resubmit):
// what the form starts from, and what each screen sends — create's full
// payload, or PATCH's "only what changed".

/** A file exactly as /media/upload returned it. */
export interface UploadedDoc {
  url: string;
  publicId: string;
}

// The order the form and the detail screen list them in.
export const USER_VEHICLE_DOCUMENT_TYPES: readonly UserVehicleDocumentType[] = [
  'ID_DOCUMENT_FRONT',
  'ID_DOCUMENT_BACK',
  'DRIVING_LICENSE',
  'VEHICLE_REGISTRATION',
];

export const USER_VEHICLE_DOCUMENT_LABELS: Record<UserVehicleDocumentType, string> = {
  ID_DOCUMENT_FRONT: 'CNIC / National ID — front',
  ID_DOCUMENT_BACK: 'CNIC / National ID — back',
  DRIVING_LICENSE: 'Driving license',
  VEHICLE_REGISTRATION: 'Vehicle registration',
};

export type UserVehicleDocuments = Record<UserVehicleDocumentType, UploadedDoc | null>;

/** Everything the form holds: the typed fields plus the uploaded photos and documents. */
export interface UserVehicleDraft {
  values: UserVehicleFormValues;
  photos: UserVehicleImageInput[];
  documents: UserVehicleDocuments;
}

export function emptyUserVehicleDocuments(): UserVehicleDocuments {
  return { ID_DOCUMENT_FRONT: null, ID_DOCUMENT_BACK: null, DRIVING_LICENSE: null, VEHICLE_REGISTRATION: null };
}

function isUserVehicleDocumentType(type: string): type is UserVehicleDocumentType {
  return (USER_VEHICLE_DOCUMENT_TYPES as readonly string[]).includes(type);
}

/**
 * The vehicle's current document of each type. Rows arrive oldest first, so
 * should a type ever have two, the newer one wins.
 */
export function documentsByType(
  documents: readonly UserVehicleDocument[],
): Partial<Record<UserVehicleDocumentType, UserVehicleDocument>> {
  const byType: Partial<Record<UserVehicleDocumentType, UserVehicleDocument>> = {};
  for (const document of documents) {
    if (isUserVehicleDocumentType(document.documentType)) byType[document.documentType] = document;
  }
  return byType;
}

function imageInputFrom(image: UserVehicleImage): UserVehicleImageInput {
  return { url: image.url, publicId: image.publicId, ...(image.altText ? { altText: image.altText } : {}) };
}

function photosInOrder(vehicle: Pick<UserVehicleDetail, 'images'>): UserVehicleImage[] {
  return [...vehicle.images].sort((a, b) => a.sortOrder - b.sortOrder);
}

/** The edit form's starting point: exactly what the vehicle has now. */
export function draftFromVehicle(vehicle: UserVehicleDetail): UserVehicleDraft {
  const current = documentsByType(vehicle.documents);
  const documents = emptyUserVehicleDocuments();
  for (const type of USER_VEHICLE_DOCUMENT_TYPES) {
    const document = current[type];
    if (document) documents[type] = { url: document.fileUrl, publicId: document.publicId };
  }

  return {
    values: {
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year ?? undefined,
      color: vehicle.color ?? '',
      plateNumber: vehicle.plateNumber,
    },
    photos: photosInOrder(vehicle).map(imageInputFrom),
    documents,
  };
}

/** Document types the draft has no file for — the form can't be sent until this is empty. */
export function missingDocumentTypes(documents: UserVehicleDocuments): UserVehicleDocumentType[] {
  return USER_VEHICLE_DOCUMENT_TYPES.filter((type) => !documents[type]);
}

/** POST /my/vehicles' body, or null while a document is still missing (all four are required). */
export function buildCreatePayload(id: string, draft: UserVehicleDraft): CreateUserVehiclePayload | null {
  const { values, photos, documents } = draft;
  const cnicFront = documents.ID_DOCUMENT_FRONT;
  const cnicBack = documents.ID_DOCUMENT_BACK;
  const drivingLicense = documents.DRIVING_LICENSE;
  const vehicleRegistration = documents.VEHICLE_REGISTRATION;
  if (!cnicFront || !cnicBack || !drivingLicense || !vehicleRegistration) return null;

  return {
    id,
    make: values.make,
    model: values.model,
    year: values.year,
    color: values.color || undefined,
    plateNumber: values.plateNumber,
    images: photos,
    cnicFrontUrl: cnicFront.url,
    cnicFrontPublicId: cnicFront.publicId,
    cnicBackUrl: cnicBack.url,
    cnicBackPublicId: cnicBack.publicId,
    drivingLicenseUrl: drivingLicense.url,
    drivingLicensePublicId: drivingLicense.publicId,
    vehicleRegistrationUrl: vehicleRegistration.url,
    vehicleRegistrationPublicId: vehicleRegistration.publicId,
  };
}

function samePhotoOrder(current: readonly UserVehicleImage[], next: readonly UserVehicleImageInput[]): boolean {
  return current.length === next.length && current.every((image, index) => image.publicId === next[index].publicId);
}

/**
 * PATCH /my/vehicles/:id's body: only the fields that differ from the vehicle
 * as loaded, the photo list only when its photos or their order changed (sent
 * whole — the backend treats it as the complete new list), and only the
 * documents whose file was replaced. `{}` means nothing changed.
 */
export function buildUpdatePayload(vehicle: UserVehicleDetail, draft: UserVehicleDraft): UpdateUserVehiclePayload {
  const { values, photos, documents } = draft;
  const payload: UpdateUserVehiclePayload = {};

  if (values.make !== vehicle.make) payload.make = values.make;
  if (values.model !== vehicle.model) payload.model = values.model;
  if (values.plateNumber !== vehicle.plateNumber) payload.plateNumber = values.plateNumber;

  // Emptied optional fields are sent as null so the backend clears them.
  const year = values.year ?? null;
  if (year !== vehicle.year) payload.year = year;
  const color = values.color ? values.color : null;
  if (color !== (vehicle.color || null)) payload.color = color;

  if (!samePhotoOrder(photosInOrder(vehicle), photos)) payload.images = photos;

  const current = documentsByType(vehicle.documents);
  const replaced: UserVehicleDocumentInput[] = [];
  for (const type of USER_VEHICLE_DOCUMENT_TYPES) {
    const next = documents[type];
    // A document can't be removed, only replaced — no file means "keep it".
    if (!next || next.publicId === current[type]?.publicId) continue;
    replaced.push({ documentType: type, url: next.url, publicId: next.publicId });
  }
  if (replaced.length > 0) payload.documents = replaced;

  return payload;
}

export function isEmptyUpdate(payload: UpdateUserVehiclePayload): boolean {
  return Object.keys(payload).length === 0;
}

export interface DocumentReviewBadge {
  label: string;
  tone: StatusTone;
}

/**
 * The badge a vehicle document shows. Review is per vehicle today, so the
 * per-document status is only meaningful once someone actually set it: a
 * plain PENDING document on a vehicle that is no longer under review carries
 * no information and gets no badge (rather than a stale "Pending").
 */
export function documentReviewBadge(
  document: Pick<UserVehicleDocument, 'status'>,
  vehicleStatus: UserVehicleStatus,
): DocumentReviewBadge | null {
  if (document.status === DocumentStatus.REJECTED) return { label: 'Rejected', tone: 'danger' };
  if (document.status === DocumentStatus.APPROVED) return { label: 'Approved', tone: 'success' };
  return vehicleStatus === UserVehicleStatus.PENDING_REVIEW ? { label: 'Under review', tone: 'info' } : null;
}

export const EDIT_UNAVAILABLE_MESSAGE = "Editing isn't available yet — please update your vehicle later.";

export interface VehicleSaveError {
  message: string;
  // The vehicle may have changed under the form (an admin decision): reload it
  // so the screen shows its real status.
  refetchVehicle: boolean;
}

/**
 * What the edit screen shows for a failed PATCH. A 404 there means the
 * backend has no edit endpoint yet (the vehicle itself just loaded fine);
 * 409 and 400 carry the backend's own explanation.
 */
export function describeVehicleSaveError(error: NormalizedApiError): VehicleSaveError {
  if (error.kind === 'not_found') return { message: EDIT_UNAVAILABLE_MESSAGE, refetchVehicle: true };
  if (error.kind === 'conflict') return { message: error.message, refetchVehicle: true };
  if (error.kind === 'validation') {
    // class-validator failures arrive as message "Validation failed" plus a
    // list of plain strings in details (typed as objects in ApiErrorBody).
    const details = ((error.fieldErrors ?? []) as unknown[])
      .map((detail) =>
        typeof detail === 'string'
          ? detail
          : typeof (detail as { message?: unknown } | null)?.message === 'string'
            ? (detail as { message: string }).message
            : null,
      )
      .filter((detail): detail is string => !!detail);
    return {
      message: details.length > 0 ? `${error.message}: ${details.join('; ')}` : error.message,
      refetchVehicle: false,
    };
  }
  return { message: error.message, refetchVehicle: false };
}
