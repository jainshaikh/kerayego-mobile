export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://10.0.2.2:3001/v1';

export const APP_ENV = process.env.EXPO_PUBLIC_APP_ENV ?? 'development';

export const IS_DEV = APP_ENV === 'development';

export const REQUEST_TIMEOUT_MS = 30000;

// Developer aid, off unless set to 'true': features/notifications/
// useLiveInquiryNotifications fakes ride notifications locally (a 10 s poll +
// the ride socket) for a simulator or device that gets no real pushes. The
// backend already sends a real push for every one of those events, so turning
// it on anywhere pushes do arrive shows each notification twice.
export const LOCAL_PUSH_BRIDGE_ENABLED = process.env.EXPO_PUBLIC_LOCAL_PUSH_BRIDGE === 'true';

// "Near me" search radius — user-adjustable via NearMeControl. 8km default
// mirrors web's DEFAULT_NEARBY_RADIUS_KM (lib/utils/userLocation.ts).
export const DEFAULT_NEARBY_RADIUS_KM = 8;
export const NEARBY_RADIUS_OPTIONS_KM = [5, 8, 15, 25, 50] as const;
