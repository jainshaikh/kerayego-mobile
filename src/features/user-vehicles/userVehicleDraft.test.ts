import { describe, expect, it } from '@jest/globals';

import type { NormalizedApiError } from '../../api/errors';
import type { UserVehicleDetail, UserVehicleDocument, UserVehicleDocumentType } from '../../types/api.types';
import { DocumentStatus, Market, UserVehicleStatus } from '../../types/enums';
import {
  EDIT_UNAVAILABLE_MESSAGE,
  USER_VEHICLE_DOCUMENT_TYPES,
  buildCreatePayload,
  buildUpdatePayload,
  describeVehicleSaveError,
  documentReviewBadge,
  documentsByType,
  draftFromVehicle,
  emptyUserVehicleDocuments,
  isEmptyUpdate,
  missingDocumentTypes,
  type UserVehicleDraft,
} from './userVehicleDraft';

const VEHICLE_ID = 'veh-0001-uuid';
const S3 = 'https://bucket.s3.ap-south-1.amazonaws.com';

const photoKey = (name: string) => `user-vehicles/${VEHICLE_ID}/photos/${name}.jpg`;
const docKey = (name: string) => `user-vehicles/${VEHICLE_ID}/documents/${name}.jpg`;

function makeDocument(
  documentType: UserVehicleDocumentType,
  overrides: Partial<UserVehicleDocument> = {},
): UserVehicleDocument {
  const publicId = docKey(documentType.toLowerCase());
  return {
    id: `doc-${documentType}`,
    documentType,
    fileUrl: `${S3}/${publicId}`,
    publicId,
    status: DocumentStatus.PENDING,
    rejectionReason: null,
    reviewedAt: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

function makeVehicle(overrides: Partial<UserVehicleDetail> = {}): UserVehicleDetail {
  return {
    id: VEHICLE_ID,
    make: 'Toyota',
    model: 'Corolla',
    year: 2020,
    color: 'White',
    plateNumber: 'ABC-123',
    country: Market.PK,
    status: UserVehicleStatus.REJECTED,
    rejectionReason: 'Plate number is unreadable',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
    images: [
      { id: 'img-a', url: `${S3}/${photoKey('a')}`, publicId: photoKey('a'), altText: null, sortOrder: 0, width: 800, height: 600 },
      { id: 'img-b', url: `${S3}/${photoKey('b')}`, publicId: photoKey('b'), altText: 'Side view', sortOrder: 1, width: null, height: null },
    ],
    documents: USER_VEHICLE_DOCUMENT_TYPES.map((type) => makeDocument(type)),
    ...overrides,
  };
}

const newPhoto = (name: string) => ({ url: `${S3}/${photoKey(name)}`, publicId: photoKey(name), width: 1024, height: 768 });
const newDoc = (name: string) => ({ url: `${S3}/${docKey(name)}`, publicId: docKey(name) });

function editedDraft(vehicle: UserVehicleDetail, edit: (draft: UserVehicleDraft) => void): UserVehicleDraft {
  const draft = draftFromVehicle(vehicle);
  edit(draft);
  return draft;
}

function apiError(overrides: Partial<NormalizedApiError>): NormalizedApiError {
  return { kind: 'unknown', message: 'Something went wrong. Please try again.', ...overrides };
}

describe('draftFromVehicle', () => {
  it('prefills the fields, the photos in poster-first order and every document', () => {
    const vehicle = makeVehicle({
      images: [
        { id: 'img-b', url: `${S3}/${photoKey('b')}`, publicId: photoKey('b'), altText: 'Side view', sortOrder: 1, width: null, height: null },
        { id: 'img-a', url: `${S3}/${photoKey('a')}`, publicId: photoKey('a'), altText: null, sortOrder: 0, width: 800, height: 600 },
      ],
    });

    const draft = draftFromVehicle(vehicle);

    expect(draft.values).toEqual({ make: 'Toyota', model: 'Corolla', year: 2020, color: 'White', plateNumber: 'ABC-123' });
    // Sorted by sortOrder; only url/publicId (+ a real altText) carry over.
    expect(draft.photos).toEqual([
      { url: `${S3}/${photoKey('a')}`, publicId: photoKey('a') },
      { url: `${S3}/${photoKey('b')}`, publicId: photoKey('b'), altText: 'Side view' },
    ]);
    expect(draft.documents.DRIVING_LICENSE).toEqual({
      url: `${S3}/${docKey('driving_license')}`,
      publicId: docKey('driving_license'),
    });
    expect(missingDocumentTypes(draft.documents)).toEqual([]);
  });

  it('maps empty optional fields to the form’s empty values', () => {
    const draft = draftFromVehicle(makeVehicle({ year: null, color: null }));
    expect(draft.values.year).toBeUndefined();
    expect(draft.values.color).toBe('');
  });

  it('leaves a document type the vehicle lacks empty', () => {
    const vehicle = makeVehicle({ documents: [makeDocument('ID_DOCUMENT_FRONT'), makeDocument('DRIVING_LICENSE')] });
    expect(missingDocumentTypes(draftFromVehicle(vehicle).documents)).toEqual(['ID_DOCUMENT_BACK', 'VEHICLE_REGISTRATION']);
  });
});

describe('documentsByType', () => {
  it('keeps the newer row when a type appears twice (rows arrive oldest first)', () => {
    const older = makeDocument('DRIVING_LICENSE', { id: 'old', publicId: docKey('old') });
    const newer = makeDocument('DRIVING_LICENSE', { id: 'new', publicId: docKey('new') });
    expect(documentsByType([older, newer]).DRIVING_LICENSE?.id).toBe('new');
  });

  it('ignores document types that are not one of the four vehicle documents', () => {
    const legacy = { ...makeDocument('DRIVING_LICENSE'), documentType: 'ID_DOCUMENT' } as unknown as UserVehicleDocument;
    expect(documentsByType([legacy])).toEqual({});
  });
});

describe('buildUpdatePayload', () => {
  it('is empty when nothing changed', () => {
    const vehicle = makeVehicle();
    const payload = buildUpdatePayload(vehicle, draftFromVehicle(vehicle));
    expect(payload).toEqual({});
    expect(isEmptyUpdate(payload)).toBe(true);
  });

  it('is empty for an untouched vehicle with no year/colour', () => {
    const vehicle = makeVehicle({ year: null, color: null });
    expect(buildUpdatePayload(vehicle, draftFromVehicle(vehicle))).toEqual({});
  });

  it('treats a stored empty colour the same as no colour', () => {
    const vehicle = makeVehicle({ color: '' });
    expect(buildUpdatePayload(vehicle, draftFromVehicle(vehicle))).toEqual({});
  });

  it('sends only the fields that changed', () => {
    const vehicle = makeVehicle();
    const draft = editedDraft(vehicle, (d) => {
      d.values.make = 'Honda';
      d.values.plateNumber = 'XYZ-789';
    });
    expect(buildUpdatePayload(vehicle, draft)).toEqual({ make: 'Honda', plateNumber: 'XYZ-789' });
  });

  it('sends model, year and colour changes', () => {
    const vehicle = makeVehicle();
    const draft = editedDraft(vehicle, (d) => {
      d.values.model = 'Civic';
      d.values.year = 2022;
      d.values.color = 'Black';
    });
    expect(buildUpdatePayload(vehicle, draft)).toEqual({ model: 'Civic', year: 2022, color: 'Black' });
  });

  it('clears an emptied year and colour with null', () => {
    const vehicle = makeVehicle();
    const draft = editedDraft(vehicle, (d) => {
      d.values.year = undefined;
      d.values.color = '';
    });
    expect(buildUpdatePayload(vehicle, draft)).toEqual({ year: null, color: null });
  });

  it('sets a year and colour the vehicle never had', () => {
    const vehicle = makeVehicle({ year: null, color: null });
    const draft = editedDraft(vehicle, (d) => {
      d.values.year = 2019;
      d.values.color = 'Silver';
    });
    expect(buildUpdatePayload(vehicle, draft)).toEqual({ year: 2019, color: 'Silver' });
  });

  describe('photos', () => {
    it('sends the complete list — kept photos as they are plus the new one — when a photo is added', () => {
      const vehicle = makeVehicle();
      const draft = editedDraft(vehicle, (d) => {
        d.photos = [...d.photos, newPhoto('c')];
      });
      expect(buildUpdatePayload(vehicle, draft)).toEqual({
        images: [
          { url: `${S3}/${photoKey('a')}`, publicId: photoKey('a') },
          { url: `${S3}/${photoKey('b')}`, publicId: photoKey('b'), altText: 'Side view' },
          newPhoto('c'),
        ],
      });
    });

    it('sends the list without a removed photo (the backend removes what is left out)', () => {
      const vehicle = makeVehicle();
      const draft = editedDraft(vehicle, (d) => {
        d.photos = d.photos.filter((p) => p.publicId !== photoKey('a'));
      });
      expect(buildUpdatePayload(vehicle, draft).images?.map((p) => p.publicId)).toEqual([photoKey('b')]);
    });

    it('sends an empty list when every photo was removed', () => {
      const vehicle = makeVehicle();
      const draft = editedDraft(vehicle, (d) => {
        d.photos = [];
      });
      expect(buildUpdatePayload(vehicle, draft)).toEqual({ images: [] });
    });

    it('sends the list when only the order (and so the poster) changed', () => {
      const vehicle = makeVehicle();
      const draft = editedDraft(vehicle, (d) => {
        d.photos = [...d.photos].reverse();
      });
      expect(buildUpdatePayload(vehicle, draft).images?.map((p) => p.publicId)).toEqual([photoKey('b'), photoKey('a')]);
    });

    it('compares against the stored sortOrder, not the order the API listed them in', () => {
      const vehicle = makeVehicle();
      const shuffled = { ...vehicle, images: [...vehicle.images].reverse() };
      expect(buildUpdatePayload(shuffled, draftFromVehicle(vehicle))).toEqual({});
    });

    it('sends a replaced photo (same count, different file)', () => {
      const vehicle = makeVehicle();
      const draft = editedDraft(vehicle, (d) => {
        d.photos = [d.photos[0], newPhoto('b2')];
      });
      expect(buildUpdatePayload(vehicle, draft).images?.map((p) => p.publicId)).toEqual([photoKey('a'), photoKey('b2')]);
    });
  });

  describe('documents', () => {
    it('sends only the replaced document, with its type, url and publicId', () => {
      const vehicle = makeVehicle();
      const draft = editedDraft(vehicle, (d) => {
        d.documents.VEHICLE_REGISTRATION = newDoc('registration-v2');
      });
      expect(buildUpdatePayload(vehicle, draft)).toEqual({
        documents: [{ documentType: 'VEHICLE_REGISTRATION', ...newDoc('registration-v2') }],
      });
    });

    it('sends several replacements in the canonical document order', () => {
      const vehicle = makeVehicle();
      const draft = editedDraft(vehicle, (d) => {
        d.documents.DRIVING_LICENSE = newDoc('licence-v2');
        d.documents.ID_DOCUMENT_FRONT = newDoc('cnic-front-v2');
      });
      expect(buildUpdatePayload(vehicle, draft).documents?.map((doc) => doc.documentType)).toEqual([
        'ID_DOCUMENT_FRONT',
        'DRIVING_LICENSE',
      ]);
    });

    it('does not resend a document whose file is unchanged', () => {
      const vehicle = makeVehicle();
      const draft = editedDraft(vehicle, (d) => {
        d.documents.ID_DOCUMENT_BACK = { ...d.documents.ID_DOCUMENT_BACK! };
      });
      expect(buildUpdatePayload(vehicle, draft)).toEqual({});
    });

    it('sends a document the vehicle was missing', () => {
      const vehicle = makeVehicle({ documents: [makeDocument('ID_DOCUMENT_FRONT'), makeDocument('ID_DOCUMENT_BACK'), makeDocument('DRIVING_LICENSE')] });
      const draft = editedDraft(vehicle, (d) => {
        d.documents.VEHICLE_REGISTRATION = newDoc('registration');
      });
      expect(buildUpdatePayload(vehicle, draft)).toEqual({
        documents: [{ documentType: 'VEHICLE_REGISTRATION', ...newDoc('registration') }],
      });
    });

    it('never asks to remove a document (an empty slot means keep it)', () => {
      const vehicle = makeVehicle();
      const draft = editedDraft(vehicle, (d) => {
        d.documents.DRIVING_LICENSE = null;
      });
      expect(buildUpdatePayload(vehicle, draft)).toEqual({});
    });
  });

  it('combines field, photo and document changes in one body', () => {
    const vehicle = makeVehicle();
    const draft = editedDraft(vehicle, (d) => {
      d.values.color = 'Grey';
      d.photos = [newPhoto('c')];
      d.documents.ID_DOCUMENT_FRONT = newDoc('cnic-front-v2');
    });
    expect(buildUpdatePayload(vehicle, draft)).toEqual({
      color: 'Grey',
      images: [newPhoto('c')],
      documents: [{ documentType: 'ID_DOCUMENT_FRONT', ...newDoc('cnic-front-v2') }],
    });
  });

  it('never sends the id or the create-only flat document fields (400 under forbidNonWhitelisted)', () => {
    const vehicle = makeVehicle();
    const draft = editedDraft(vehicle, (d) => {
      d.values.make = 'Suzuki';
      d.photos = [newPhoto('c')];
      d.documents.ID_DOCUMENT_FRONT = newDoc('cnic-front-v2');
    });
    const allowed = ['make', 'model', 'year', 'color', 'plateNumber', 'country', 'images', 'documents'];
    for (const key of Object.keys(buildUpdatePayload(vehicle, draft))) expect(allowed).toContain(key);
  });
});

describe('buildCreatePayload', () => {
  const draft: UserVehicleDraft = {
    values: { make: 'Toyota', model: 'Corolla', year: undefined, color: '', plateNumber: 'ABC-123' },
    photos: [newPhoto('a')],
    documents: {
      ID_DOCUMENT_FRONT: newDoc('front'),
      ID_DOCUMENT_BACK: newDoc('back'),
      DRIVING_LICENSE: newDoc('licence'),
      VEHICLE_REGISTRATION: newDoc('registration'),
    },
  };

  it('sends the client-generated id and maps each document to its flat field pair', () => {
    expect(buildCreatePayload(VEHICLE_ID, draft)).toEqual({
      id: VEHICLE_ID,
      make: 'Toyota',
      model: 'Corolla',
      year: undefined,
      color: undefined,
      plateNumber: 'ABC-123',
      images: [newPhoto('a')],
      cnicFrontUrl: newDoc('front').url,
      cnicFrontPublicId: newDoc('front').publicId,
      cnicBackUrl: newDoc('back').url,
      cnicBackPublicId: newDoc('back').publicId,
      drivingLicenseUrl: newDoc('licence').url,
      drivingLicensePublicId: newDoc('licence').publicId,
      vehicleRegistrationUrl: newDoc('registration').url,
      vehicleRegistrationPublicId: newDoc('registration').publicId,
    });
  });

  it('is null while any of the four documents is missing', () => {
    for (const type of USER_VEHICLE_DOCUMENT_TYPES) {
      expect(buildCreatePayload(VEHICLE_ID, { ...draft, documents: { ...draft.documents, [type]: null } })).toBeNull();
    }
  });

  it('starts from an empty document set with all four missing', () => {
    expect(missingDocumentTypes(emptyUserVehicleDocuments())).toEqual([...USER_VEHICLE_DOCUMENT_TYPES]);
  });
});

describe('documentReviewBadge', () => {
  it.each(Object.values(UserVehicleStatus))('shows an actual per-document decision on a %s vehicle', (vehicleStatus) => {
    expect(documentReviewBadge({ status: DocumentStatus.REJECTED }, vehicleStatus)).toEqual({ label: 'Rejected', tone: 'danger' });
    expect(documentReviewBadge({ status: DocumentStatus.APPROVED }, vehicleStatus)).toEqual({ label: 'Approved', tone: 'success' });
  });

  it('shows a PENDING document as under review only while the vehicle is', () => {
    expect(documentReviewBadge({ status: DocumentStatus.PENDING }, UserVehicleStatus.PENDING_REVIEW)).toEqual({
      label: 'Under review',
      tone: 'info',
    });
    for (const status of [UserVehicleStatus.APPROVED, UserVehicleStatus.REJECTED, UserVehicleStatus.SUSPENDED]) {
      expect(documentReviewBadge({ status: DocumentStatus.PENDING }, status)).toBeNull();
    }
  });
});

describe('describeVehicleSaveError', () => {
  it('reads a 404 as "editing isn’t available yet" (a backend without PATCH /my/vehicles/:id) and reloads', () => {
    expect(
      describeVehicleSaveError(apiError({ kind: 'not_found', statusCode: 404, message: 'Cannot PATCH /v1/my/vehicles/x' })),
    ).toEqual({ message: EDIT_UNAVAILABLE_MESSAGE, refetchVehicle: true });
  });

  it('shows a 409 as the backend says it and reloads the vehicle', () => {
    const message = 'This vehicle was just changed (for example reviewed by our team) — reload it and try again';
    expect(describeVehicleSaveError(apiError({ kind: 'conflict', statusCode: 409, message }))).toEqual({
      message,
      refetchVehicle: true,
    });
  });

  it('shows a 400 as the backend says it', () => {
    const message = 'Photo "user-vehicles/other/photos/x.jpg" wasn\'t uploaded for this vehicle';
    expect(describeVehicleSaveError(apiError({ kind: 'validation', statusCode: 400, message }))).toEqual({
      message,
      refetchVehicle: false,
    });
  });

  it('appends class-validator details (plain strings on the wire) to "Validation failed"', () => {
    const details = ['year must not be greater than 2028', 'plateNumber must be shorter than or equal to 20 characters'];
    const error = apiError({
      kind: 'validation',
      statusCode: 400,
      message: 'Validation failed',
      fieldErrors: details as unknown as NormalizedApiError['fieldErrors'],
    });
    expect(describeVehicleSaveError(error).message).toBe(`Validation failed: ${details.join('; ')}`);
  });

  it('also accepts details shaped as { message } objects', () => {
    const error = apiError({ kind: 'validation', message: 'Validation failed', fieldErrors: [{ message: 'make is too short' }] });
    expect(describeVehicleSaveError(error).message).toBe('Validation failed: make is too short');
  });

  it('passes any other failure through without reloading', () => {
    const message = 'No connection. Check your internet and try again.';
    expect(describeVehicleSaveError(apiError({ kind: 'network', message }))).toEqual({ message, refetchVehicle: false });
  });
});
