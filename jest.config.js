// Unit tests (`npm test`). jest-expo's preset supplies the babel-preset-expo
// transform, the React Native module mocks and the tsconfig '@/*' path alias.
//
// Version pin: jest-expo 57.0.4 + @react-native/jest-preset 0.86.2 match the
// installed react-native 0.86.2 — jest-expo 57.0.5 peers on
// @react-native/jest-preset ^0.86.3, so bump all three together.
//
// Test files import describe/it/expect/jest from '@jest/globals' rather than
// relying on ambient globals: TypeScript 6 no longer auto-includes @types
// packages, and this keeps jest's globals out of the app's own type space.
module.exports = {
  preset: 'jest-expo',
  // Only src/ is crawled — android/ is a multi-GB generated build folder and
  // example/ is the unrelated leftover Expo template. Keep tests out of
  // src/app/, where Expo Router would treat them as routes.
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts?(x)'],
  setupFiles: ['<rootDir>/jest.setup.ts'],
};
