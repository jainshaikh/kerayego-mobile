import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  hasShownRatingPrompt,
  markRatingPromptShown,
  ratingPromptKey,
  resetRatingPromptSessionForTests,
} from './rating-prompt';

// AsyncStorage is the in-memory mock registered in jest.setup.ts.
beforeEach(async () => {
  await AsyncStorage.clear();
  resetRatingPromptSessionForTests();
  jest.restoreAllMocks();
});

describe('rating prompt store', () => {
  it('keys each ride by context and id', () => {
    expect(ratingPromptKey('tripDriver', 't-1')).toBe('ratingPrompt.shown:tripDriver:t-1');
    expect(ratingPromptKey('booking', 'b-1')).toBe('ratingPrompt.shown:booking:b-1');
  });

  it('is not shown until marked, then stays shown across sessions', async () => {
    await expect(hasShownRatingPrompt('tripRider', 'ti-1')).resolves.toBe(false);
    await markRatingPromptShown('tripRider', 'ti-1', 1_791_453_600_000);
    expect(await AsyncStorage.getItem('ratingPrompt.shown:tripRider:ti-1')).toBe('1791453600000');
    resetRatingPromptSessionForTests();
    await expect(hasShownRatingPrompt('tripRider', 'ti-1')).resolves.toBe(true);
  });

  it('keeps contexts and rides apart', async () => {
    await markRatingPromptShown('tripDriver', 'x-1');
    await expect(hasShownRatingPrompt('tripRider', 'x-1')).resolves.toBe(false);
    await expect(hasShownRatingPrompt('tripDriver', 'x-2')).resolves.toBe(false);
  });

  it('a failed read counts as not shown yet', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'));
    await expect(hasShownRatingPrompt('booking', 'b-1')).resolves.toBe(false);
  });

  it('a failed write still remembers it for this session, without throwing', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk'));
    await expect(markRatingPromptShown('booking', 'b-2')).resolves.toBeUndefined();
    await expect(hasShownRatingPrompt('booking', 'b-2')).resolves.toBe(true);
  });
});
