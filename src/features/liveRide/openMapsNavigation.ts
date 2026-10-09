import { Linking } from 'react-native';

// Coordinates when the point has them; a stop the driver typed as free text
// has none, so its label is searched for instead.
export interface NavigationTarget {
  lat?: number | null;
  lng?: number | null;
  label?: string | null;
}

/** The Google Maps directions link for a point, or null when there's neither coordinates nor a label to go by. */
export function mapsNavigationUrl(target: NavigationTarget): string | null {
  const { lat, lng } = target;
  const label = target.label?.trim();
  const destination =
    Number.isFinite(lat) && Number.isFinite(lng) ? `${lat},${lng}` : label ? encodeURIComponent(label) : null;
  if (!destination) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving`;
}

// Hands off to the device's external navigation app for the given point —
// purely a deep link, never touches the pickup/dropoff/arrival flow itself.
// Swallows any failure so a missing/unsupported maps app can never crash the
// calling screen.
export function openMapsNavigation(target: NavigationTarget): void {
  const url = mapsNavigationUrl(target);
  if (url) Linking.openURL(url).catch(() => {});
}
