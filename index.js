// Custom app entry — Expo Router's documented pattern for running code
// before the app loads (https://docs.expo.dev/router/installation/,
// "custom entry point"): side effects first, then the router's own entry.
//
// The background location tasks (the carpool driver's, and the customer's
// "sharing your location with your driver") have to be defined at module scope
// on every JS start, including when the OS starts the app in the background
// with no UI mounted, which never reaches the routes (src/app).
import './src/features/liveRide/backgroundLocation/registerDriverLocationTask';
import './src/features/liveRide/backgroundLocation/registerCustomerLocationTask';

import 'expo-router/entry';
