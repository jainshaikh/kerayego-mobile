import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

import type { LocationShareTarget } from '../../../types/api.types';
import { isCustomerServerStopReason, sameShareTarget } from './customerLocationRules';
import type { CustomerLocationStatus } from './customerLocationSharing';

// What the sharing card (CustomerLocationSharingCard) says for one open
// window — pure, so every case is unit-tested.

export interface CustomerSharingView {
  tone: 'active' | 'warning' | 'neutral';
  icon: ComponentProps<typeof Ionicons>['name'];
  title: string;
  detail: string | null;
  // A fix the customer can try (re-asks permission / restarts), or null.
  fix: 'Turn on' | 'Try again' | null;
}

export function describeCustomerSharing(input: {
  // The window, as GET /users/me/location-sharing lists it.
  listed: LocationShareTarget;
  status: CustomerLocationStatus;
  // The label of a different window being shared right now, if any.
  otherLabel: string | null;
}): CustomerSharingView {
  const { listed, status, otherLabel } = input;
  const driver = listed.driverName ?? 'Your driver';

  if (listed.paused) {
    return {
      tone: 'neutral',
      icon: 'pause-circle-outline',
      title: 'Location sharing is paused',
      detail: `${driver} can't see where you are. Resume to share it again until pickup.`,
      fix: null,
    };
  }

  const here = 'target' in status && sameShareTarget(status.target, listed);
  if (here) {
    switch (status.state) {
      case 'running':
        return {
          tone: 'active',
          icon: 'navigate',
          title: 'Sharing your location with your driver',
          detail: `${driver} can see where you are until pickup — also while your phone is locked.`,
          fix: null,
        };
      case 'starting':
        return {
          tone: 'active',
          icon: 'navigate',
          title: 'Sharing your location with your driver',
          detail: 'Starting…',
          fix: null,
        };
      case 'failed':
        if (status.reason === 'permission') {
          return {
            tone: 'warning',
            icon: 'location-outline',
            title: 'Location access is off',
            detail: `${driver} can't see where you are. Allow location to share it until pickup.`,
            fix: 'Turn on',
          };
        }
        if (status.reason === 'start_failed') {
          return {
            tone: 'warning',
            icon: 'warning-outline',
            title: "Couldn't start sharing your location",
            detail: `${driver} can't see where you are yet.`,
            fix: 'Try again',
          };
        }
        return {
          tone: 'warning',
          icon: 'warning-outline',
          title: "This version of the app can't share your location",
          detail: 'Update KerayeGo to share your location with your driver.',
          fix: null,
        };
      case 'stopped':
        if (status.reason === 'driver_sharing') {
          return {
            tone: 'neutral',
            icon: 'car-outline',
            title: "Not sharing while you're driving a trip",
            detail: 'Your location is already being shared with your riders.',
            fix: null,
          };
        }
        if (isCustomerServerStopReason(status.reason)) {
          return {
            tone: 'warning',
            icon: 'warning-outline',
            title: 'Location sharing stopped',
            detail: `${driver} can't see where you are right now.`,
            fix: 'Try again',
          };
        }
        break;
      default:
        break;
    }
  }

  if (otherLabel) {
    return {
      tone: 'neutral',
      icon: 'location-outline',
      title: 'Sharing your location for another ride',
      detail: `One ride at a time — now: ${otherLabel}.`,
      fix: null,
    };
  }

  return {
    tone: 'neutral',
    icon: 'location-outline',
    title: 'Sharing your location with your driver',
    detail: 'Starts while KerayeGo is open.',
    fix: null,
  };
}
