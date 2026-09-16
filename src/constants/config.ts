export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://10.0.2.2:3001/v1';

export const APP_ENV = process.env.EXPO_PUBLIC_APP_ENV ?? 'development';

export const IS_DEV = APP_ENV === 'development';

export const REQUEST_TIMEOUT_MS = 30000;

// "Near me" search radius — user-adjustable via NearMeControl. 8km default
// mirrors web's DEFAULT_NEARBY_RADIUS_KM (lib/utils/userLocation.ts).
export const DEFAULT_NEARBY_RADIUS_KM = 8;
export const NEARBY_RADIUS_OPTIONS_KM = [5, 8, 15, 25, 50] as const;
