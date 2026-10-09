import type { TripActionDraft } from '../../storage/offline-trip-queue';
import { TripEventType } from '../../types/enums';

export interface RiderEventOverlay {
  pickupConfirmedAt?: string;
  droppedOffAt?: string;
}

/**
 * What the screens show ahead of the server for one trip: the effect of every
 * action still waiting in the offline queue, plus those already applied this
 * session that a refetch may not have caught up with yet. Server data always
 * wins wherever it has a value — this only fills the gaps.
 */
export interface TripActionOverlay {
  started: boolean;
  ended: boolean;
  // Keyed by tripInquiryId.
  riderEvents: Record<string, RiderEventOverlay>;
  noShowIds: Set<string>;
  // The driver's ARRIVED, by the stop it was recorded at.
  arrivedStopIds: Set<string>;
  // A rider's own ARRIVED self-report (no stop on the payload), by tripInquiryId.
  arrivedInquiryIds: Set<string>;
}

function stopIdOf(payload: Record<string, unknown> | undefined): string | null {
  const stopId = payload?.stopId;
  return typeof stopId === 'string' ? stopId : null;
}

/**
 * Folds `actions` (oldest first) into a TripActionOverlay. An id seen twice
 * counts once (an action is briefly both applied and still queued while the
 * flush removes it). A PICKUP after a NO_SHOW for the same rider clears the
 * no-show — that's how the driver reverses one.
 */
export function deriveTripActionOverlay(actions: readonly TripActionDraft[]): TripActionOverlay {
  const overlay: TripActionOverlay = {
    started: false,
    ended: false,
    riderEvents: {},
    noShowIds: new Set(),
    arrivedStopIds: new Set(),
    arrivedInquiryIds: new Set(),
  };
  const seen = new Set<string>();

  for (const action of actions) {
    if (seen.has(action.id)) continue;
    seen.add(action.id);

    if (action.kind === 'start') {
      overlay.started = true;
      continue;
    }
    if (action.kind === 'end') {
      overlay.ended = true;
      continue;
    }

    const { type, tripInquiryId, occurredAt, payload } = action.payload;
    if (type === TripEventType.ARRIVED) {
      const stopId = stopIdOf(payload);
      if (stopId) overlay.arrivedStopIds.add(stopId);
      else if (tripInquiryId) overlay.arrivedInquiryIds.add(tripInquiryId);
      continue;
    }
    if (!tripInquiryId) continue;

    if (type === TripEventType.PICKUP) {
      overlay.riderEvents[tripInquiryId] = { ...overlay.riderEvents[tripInquiryId], pickupConfirmedAt: occurredAt };
      overlay.noShowIds.delete(tripInquiryId);
    } else if (type === TripEventType.DROPOFF) {
      overlay.riderEvents[tripInquiryId] = { ...overlay.riderEvents[tripInquiryId], droppedOffAt: occurredAt };
    } else if (type === TripEventType.NO_SHOW) {
      overlay.noShowIds.add(tripInquiryId);
    }
  }

  return overlay;
}
