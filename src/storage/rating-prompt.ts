import AsyncStorage from '@react-native-async-storage/async-storage';

// Which rides this device has already opened the end-of-ride rating sheet for
// on its own (features/reviews/useRatingPrompt.ts). It opens once per ride
// per device — closing it never brings it back automatically; the summary's
// card and Profile → Reviews still let people rate later.
//
// - tripDriver: a carpool trip the user drove (id = tripId)
// - tripRider: a carpool seat the user rode (id = tripInquiryId)
// - booking: a rental the user booked (id = bookingRequestId)
export type RatingPromptContext = 'tripDriver' | 'tripRider' | 'booking';

const KEY_PREFIX = 'ratingPrompt.shown';

export function ratingPromptKey(context: RatingPromptContext, id: string): string {
  return `${KEY_PREFIX}:${context}:${id}`;
}

// Also remembered in memory, so a storage failure can't make the sheet pop
// up again on the same ride while the app stays open.
const shownThisSession = new Set<string>();

/** Whether the sheet has opened on its own for this ride before. A failed read counts as not yet. */
export async function hasShownRatingPrompt(context: RatingPromptContext, id: string): Promise<boolean> {
  const key = ratingPromptKey(context, id);
  if (shownThisSession.has(key)) return true;
  try {
    return (await AsyncStorage.getItem(key)) !== null;
  } catch {
    return false;
  }
}

/** Records that the sheet opened on its own for this ride. Never throws. */
export async function markRatingPromptShown(context: RatingPromptContext, id: string, now: number = Date.now()): Promise<void> {
  const key = ratingPromptKey(context, id);
  shownThisSession.add(key);
  try {
    await AsyncStorage.setItem(key, String(now));
  } catch {
    // Kept in memory for this session; at worst it opens once more after a restart.
  }
}

/** Test-only: forget the in-memory record. */
export function resetRatingPromptSessionForTests(): void {
  shownThisSession.clear();
}
