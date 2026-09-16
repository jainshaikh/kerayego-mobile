import { Linking } from 'react-native';

// Hands off to the device's external navigation app for the given point —
// purely a deep link, never touches the pickup/dropoff/arrival flow itself.
// Swallows any failure so a missing/unsupported maps app can never crash the
// calling screen.
export function openMapsNavigation(point: { lat: number; lng: number }): void {
  const url = `https://www.google.com/maps/dir/?api=1&destination=${point.lat},${point.lng}&travelmode=driving`;
  Linking.openURL(url).catch(() => {});
}
