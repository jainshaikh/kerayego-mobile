// Custom app entry — Expo Router's documented pattern for running code
// before the app loads (https://docs.expo.dev/router/installation/,
// "custom entry point"): side effects first, then the router's own entry.
//
// The driver's background location task has to be defined at module scope on
// every JS start, including when the OS starts the app in the background with
// no UI mounted, which never reaches the routes (src/app).
import './src/features/liveRide/backgroundLocation/registerDriverLocationTask';

import 'expo-router/entry';
