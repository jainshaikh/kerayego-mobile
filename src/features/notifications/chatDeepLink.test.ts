import { describe, expect, it } from '@jest/globals';

import { TripStatus } from '../../types/enums';
import type { RiderSeatStage } from '../trip-inquiries/riderLiveTrip/riderTripState';
import { driverChatLinkDecision, riderChatAvailable, riderChatLinkDecision } from './chatDeepLink';

const INQ = 'inq-1';
const riders = [
  { id: INQ, user: { name: 'Ayesha' } },
  { id: 'inq-2', user: { name: 'Bilal' } },
];

function driver(overrides: Partial<Parameters<typeof driverChatLinkDecision>[0]> = {}) {
  return driverChatLinkDecision({
    requestedInquiryId: INQ,
    tripStatus: TripStatus.IN_PROGRESS,
    cockpitShown: true,
    manifestRiders: riders,
    manifestLoading: false,
    inboxRiderName: null,
    ...overrides,
  });
}

describe('driverChatLinkDecision', () => {
  it('waits for the trip, then for the manifest', () => {
    expect(driver({ tripStatus: undefined })).toEqual({ kind: 'wait' });
    expect(driver({ manifestRiders: undefined, manifestLoading: true })).toEqual({ kind: 'wait' });
  });

  it('opens the rider’s thread in the cockpit, named from the manifest', () => {
    expect(driver()).toEqual({ kind: 'open', tripInquiryId: INQ, otherPartyName: 'Ayesha' });
    expect(driver({ tripStatus: TripStatus.COMPLETED })).toEqual({ kind: 'open', tripInquiryId: INQ, otherPartyName: 'Ayesha' });
  });

  it('still opens the thread when the manifest failed to load', () => {
    expect(driver({ manifestRiders: undefined, inboxRiderName: 'Ayesha' })).toEqual({
      kind: 'open',
      tripInquiryId: INQ,
      otherPartyName: 'Ayesha',
    });
    expect(driver({ manifestRiders: undefined })).toEqual({ kind: 'open', tripInquiryId: INQ, otherPartyName: 'Rider' });
  });

  it('explains a rider whose seat is no longer on the manifest', () => {
    const decision = driver({ manifestRiders: [riders[1]], inboxRiderName: 'Ayesha' });
    expect(decision).toEqual({
      kind: 'unavailable',
      message: 'Ayesha no longer has a confirmed seat on this trip, so their chat is closed.',
    });
  });

  it('explains that chat opens once the trip starts', () => {
    expect(driver({ tripStatus: TripStatus.ACTIVE, cockpitShown: false, inboxRiderName: 'Ayesha' })).toEqual({
      kind: 'unavailable',
      message: 'Chat with Ayesha opens once you start the trip.',
    });
  });

  it.each([TripStatus.CANCELLED, TripStatus.SUSPENDED])('explains a %s trip’s chats are closed', (status) => {
    expect(driver({ tripStatus: status, cockpitShown: false })).toEqual({
      kind: 'unavailable',
      message: "This trip isn't running, so its chats are closed.",
    });
  });
});

describe('riderChatAvailable', () => {
  it.each<[RiderSeatStage, TripStatus, boolean]>([
    ['live', TripStatus.IN_PROGRESS, true],
    ['noShow', TripStatus.IN_PROGRESS, true],
    ['noShow', TripStatus.COMPLETED, false],
    ['upcoming', TripStatus.ACTIVE, false],
    ['droppedOff', TripStatus.IN_PROGRESS, false],
    ['request', TripStatus.ACTIVE, false],
    ['tripCompleted', TripStatus.COMPLETED, false],
  ])('%s on a %s trip → %s', (stage, tripStatus, expected) => {
    expect(riderChatAvailable(stage, tripStatus)).toBe(expected);
  });
});

describe('riderChatLinkDecision', () => {
  const base = { tripInquiryId: INQ, driverName: 'Kamran' };

  it('waits for the request', () => {
    expect(riderChatLinkDecision({ ...base, stage: null, tripStatus: undefined })).toEqual({ kind: 'wait' });
  });

  it('opens the chat during the ride, and for a no-show while the trip runs', () => {
    const open = { kind: 'open', tripInquiryId: INQ, otherPartyName: 'Kamran' };
    expect(riderChatLinkDecision({ ...base, stage: 'live', tripStatus: TripStatus.IN_PROGRESS })).toEqual(open);
    expect(riderChatLinkDecision({ ...base, stage: 'noShow', tripStatus: TripStatus.IN_PROGRESS })).toEqual(open);
  });

  it('points to call/WhatsApp before the trip starts', () => {
    expect(riderChatLinkDecision({ ...base, stage: 'upcoming', tripStatus: TripStatus.ACTIVE })).toEqual({
      kind: 'unavailable',
      message: 'Chat with Kamran opens once the trip starts. Until then, you can call or WhatsApp them from this screen.',
    });
  });

  it.each<[RiderSeatStage, TripStatus]>([
    ['droppedOff', TripStatus.IN_PROGRESS],
    ['tripCompleted', TripStatus.COMPLETED],
    ['noShow', TripStatus.COMPLETED],
    ['request', TripStatus.ACTIVE],
    ['tripCancelled', TripStatus.CANCELLED],
  ])('says chat is only for the ride when %s on a %s trip', (stage, tripStatus) => {
    expect(riderChatLinkDecision({ ...base, stage, tripStatus })).toEqual({
      kind: 'unavailable',
      message: 'In-app chat is only available while your ride is under way.',
    });
  });
});
