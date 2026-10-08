import { jest } from '@jest/globals';

// AsyncStorage has no native module under Jest — swap in the package's own
// in-memory mock for every test file (backs storage/offline-trip-queue.ts).
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
