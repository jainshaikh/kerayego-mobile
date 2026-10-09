import { isBackgroundLocationSupported } from './driverLocationSharing';

// Imported first thing by the app entry (index.js), before Expo Router: the
// driver's background location task must be defined in every JS start (see
// defineDriverLocationTask.ts).
//
// Guarded, and a plain require on purpose: expo-task-manager's JS throws on
// import when its native module isn't in the binary — Expo Go, web, or a dev
// client built before the package was added — and a static import would take
// the whole app down at launch there. Without it the app simply has no
// background sharing (the cockpit says so).
if (isBackgroundLocationSupported()) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./defineDriverLocationTask');
}
