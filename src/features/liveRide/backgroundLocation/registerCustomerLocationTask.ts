import { isBackgroundLocationSupported } from './driverLocationSharing';

// Imported by the app entry (index.js), before Expo Router: the customer's
// location task must be defined in every JS start (see
// defineCustomerLocationTask.ts). Guarded with a plain require for the same
// reason as registerDriverLocationTask.ts — without expo-task-manager's
// native module the app simply has no customer location sharing (the
// sharing card says so).
if (isBackgroundLocationSupported()) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./defineCustomerLocationTask');
}
