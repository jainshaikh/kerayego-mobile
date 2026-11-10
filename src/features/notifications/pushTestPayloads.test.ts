import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from '@jest/globals';

import { resolvePushTarget, riderRequestRoute } from './pushRouting';

// The iOS-simulator payloads behind `npm run test:push*` (scripts/push/*.apns).
// expo-notifications hands an iOS remote notification's top-level "body"
// object to the app as `content.data`, so that's where the push data lives.
// No recipientUserId, so a tap routes for whoever is signed in.
function payloadData(file: string): unknown {
  const raw = readFileSync(join(__dirname, '..', '..', '..', 'scripts', 'push', file), 'utf8');
  return (JSON.parse(raw) as { body: unknown }).body;
}

const INQUIRY_ID = 'REPLACE_WITH_TRIP_INQUIRY_ID';

describe('npm run test:push* payloads', () => {
  it.each([
    ['test-push.apns', riderRequestRoute(INQUIRY_ID)],
    ['test-chat.apns', riderRequestRoute(INQUIRY_ID, true)],
    ['test-trip.apns', riderRequestRoute(INQUIRY_ID)],
  ])('%s routes to the rider screen', (file, route) => {
    expect(resolvePushTarget(payloadData(file), 'any-signed-in-user')).toEqual({ kind: 'route', route });
  });
});
