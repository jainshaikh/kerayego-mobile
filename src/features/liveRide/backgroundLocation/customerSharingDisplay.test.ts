import { describe, expect, it } from '@jest/globals';

import type { LocationShareTarget } from '../../../types/api.types';
import { describeCustomerSharing, type CustomerSharingView } from './customerSharingDisplay';
import type { CustomerLocationFailure, CustomerLocationStatus } from './customerLocationSharing';

const LISTED: LocationShareTarget = {
  kind: 'BOOKING',
  id: 'bk-1',
  paused: false,
  pickupAt: '2026-10-29T10:00:00.000Z',
  label: '2023 Toyota Corolla',
  driverName: 'Imran',
};
const HERE = { kind: 'BOOKING' as const, id: 'bk-1' };
const ELSEWHERE = { kind: 'TRIP_INQUIRY' as const, id: 'inq-a' };

function view(status: CustomerLocationStatus, listed: LocationShareTarget = LISTED, otherLabel: string | null = null) {
  return describeCustomerSharing({ listed, status, otherLabel });
}

describe('describeCustomerSharing', () => {
  it('running here: sharing with the named driver', () => {
    expect(view({ state: 'running', target: HERE })).toMatchObject({
      tone: 'active',
      title: 'Sharing your location with your driver',
      detail: expect.stringContaining('Imran can see where you are'),
      fix: null,
    });
  });

  it('paused wins over everything, with no fix', () => {
    expect(view({ state: 'running', target: HERE }, { ...LISTED, paused: true })).toMatchObject({
      title: 'Location sharing is paused',
      fix: null,
    });
  });

  it.each<[CustomerLocationFailure, string, CustomerSharingView['fix']]>([
    ['permission', 'Location access is off', 'Turn on'],
    ['start_failed', "Couldn't start sharing your location", 'Try again'],
    ['unavailable', "This version of the app can't share your location", null],
  ])('failed (%s) warns: %s', (reason, title, fix) => {
    expect(view({ state: 'failed', target: HERE, reason })).toMatchObject({ tone: 'warning', title, fix });
  });

  it('says so while the person is driving a trip', () => {
    expect(view({ state: 'stopped', target: HERE, reason: 'driver_sharing' }).title).toBe(
      "Not sharing while you're driving a trip",
    );
  });

  it('a server refusal offers Try again', () => {
    expect(view({ state: 'stopped', target: HERE, reason: 'sharing_closed' })).toMatchObject({
      tone: 'warning',
      fix: 'Try again',
    });
  });

  it("another window being shared (one at a time) — and a failure elsewhere isn't this one's", () => {
    expect(view({ state: 'running', target: ELSEWHERE }, LISTED, 'Lahore → Islamabad')).toMatchObject({
      title: 'Sharing your location for another ride',
      detail: 'One ride at a time — now: Lahore → Islamabad.',
    });
    expect(view({ state: 'failed', target: ELSEWHERE, reason: 'permission' }).tone).toBe('neutral');
  });

  it('falls back to a neutral "starts while open" line, and "Your driver" without a name', () => {
    expect(view({ state: 'idle' })).toMatchObject({ tone: 'neutral', detail: 'Starts while KerayeGo is open.' });
    expect(view({ state: 'failed', target: HERE, reason: 'permission' }, { ...LISTED, driverName: null }).detail).toContain(
      "Your driver can't see",
    );
  });
});
