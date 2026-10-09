import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type * as NotificationsModule from 'expo-notifications';

import { PUSH_TAP_MAX_AGE_MS, createPushTapInbox, isPushTapExpired, pushTapFromResponse, type PushTap } from './pushTapInbox';

const DEFAULT_ACTION = 'expo.modules.notifications.actions.DEFAULT';

jest.mock('expo-notifications', () => ({
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  addNotificationResponseReceivedListener: jest.fn(),
  getLastNotificationResponse: jest.fn(),
  clearLastNotificationResponse: jest.fn(),
}));

type Response = NotificationsModule.NotificationResponse;

function response(identifier: string, data: Record<string, unknown>, actionIdentifier = DEFAULT_ACTION): Response {
  return {
    actionIdentifier,
    notification: {
      date: 1_791_453_600_000,
      request: { identifier, content: { data } },
    },
  } as unknown as Response;
}

function tap(key: string, capturedAt = 0): PushTap {
  return { key, data: { type: 'trip.started' }, capturedAt };
}

describe('createPushTapInbox', () => {
  it('holds a captured tap until it is taken', () => {
    const inbox = createPushTapInbox();
    expect(inbox.peek()).toBeNull();
    inbox.capture(tap('a'));
    expect(inbox.peek()?.key).toBe('a');
    expect(inbox.take()?.key).toBe('a');
    expect(inbox.peek()).toBeNull();
    expect(inbox.take()).toBeNull();
  });

  it('ignores a second delivery of the same tap, even after the first was taken', () => {
    const inbox = createPushTapInbox();
    inbox.capture(tap('a'));
    inbox.take();
    inbox.capture(tap('a'));
    expect(inbox.peek()).toBeNull();
  });

  it('keeps only the newest tap', () => {
    const inbox = createPushTapInbox();
    inbox.capture(tap('a'));
    inbox.capture(tap('b'));
    expect(inbox.take()?.key).toBe('b');
  });

  it('notifies subscribers and bumps the version on every change, and not on a duplicate', () => {
    const inbox = createPushTapInbox();
    const listener = jest.fn();
    const unsubscribe = inbox.subscribe(listener);
    const v0 = inbox.getVersion();
    inbox.capture(tap('a'));
    inbox.capture(tap('a'));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(inbox.getVersion()).toBe(v0 + 1);
    inbox.take();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    inbox.capture(tap('b'));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('isPushTapExpired', () => {
  it('expires a tap only once it is older than the limit', () => {
    expect(isPushTapExpired(tap('a', 1000), 1000 + PUSH_TAP_MAX_AGE_MS)).toBe(false);
    expect(isPushTapExpired(tap('a', 1000), 1000 + PUSH_TAP_MAX_AGE_MS + 1)).toBe(true);
  });
});

describe('pushTapFromResponse', () => {
  it('keys a plain tap by its request identifier and keeps its data', () => {
    expect(pushTapFromResponse(response('req-1', { type: 'chat_message' }), 5)).toEqual({
      key: 'req-1',
      data: { type: 'chat_message' },
      capturedAt: 5,
    });
  });

  it('ignores anything but a plain tap (a dismissal or a custom action)', () => {
    expect(pushTapFromResponse(response('req-1', {}, 'com.apple.UNNotificationDismissActionIdentifier'), 5)).toBeNull();
  });

  it('falls back to the delivery time when there is no identifier', () => {
    expect(pushTapFromResponse(response('', {}), 5)?.key).toBe('at:1791453600000');
  });
});

describe('startPushTapCapture', () => {
  let Notifications: jest.Mocked<typeof NotificationsModule>;
  let inboxModule: typeof import('./pushTapInbox');

  // A fresh copy of the module (its once-only start and its inbox) per test.
  // The expo-notifications factory mock is shared across copies, so its
  // calls and return values are reset instead.
  beforeEach(() => {
    jest.isolateModules(() => {
      Notifications = jest.requireMock<jest.Mocked<typeof NotificationsModule>>('expo-notifications');
      inboxModule = jest.requireActual<typeof import('./pushTapInbox')>('./pushTapInbox');
    });
    Notifications.addNotificationResponseReceivedListener.mockReset();
    Notifications.getLastNotificationResponse.mockReset();
    Notifications.clearLastNotificationResponse.mockReset();
  });

  it('captures the tap that launched the app and clears it natively, once', () => {
    Notifications.getLastNotificationResponse.mockReturnValue(response('cold', { type: 'trip.started' }));
    inboxModule.startPushTapCapture();
    inboxModule.startPushTapCapture();

    expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalledTimes(1);
    expect(inboxModule.pushTapInbox.peek()?.key).toBe('cold');
    expect(Notifications.clearLastNotificationResponse).toHaveBeenCalled();
  });

  it('routes the same tap only once when both the listener and the last response report it', () => {
    Notifications.getLastNotificationResponse.mockReturnValue(null);
    inboxModule.startPushTapCapture();
    const listener = Notifications.addNotificationResponseReceivedListener.mock.calls[0][0];

    listener(response('warm', { type: 'chat_message' }));
    expect(inboxModule.pushTapInbox.take()?.key).toBe('warm');

    Notifications.getLastNotificationResponse.mockReturnValue(response('warm', { type: 'chat_message' }));
    inboxModule.captureLastNotificationResponse();
    expect(inboxModule.pushTapInbox.peek()).toBeNull();
  });

  it('survives a platform without the last-response API', () => {
    Notifications.getLastNotificationResponse.mockImplementation(() => {
      throw new Error('unavailable');
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => inboxModule.startPushTapCapture()).not.toThrow();
    expect(inboxModule.pushTapInbox.peek()).toBeNull();
    warn.mockRestore();
  });
});
