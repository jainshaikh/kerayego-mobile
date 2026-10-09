import type { ChatMessage, ChatMessagesResult } from '../../api/trip-inquiries.api';

// GET /trip-inquiries/:id/messages (TripInquiriesService.getMessages) pages
// OLDEST first: up to 50 messages with createdAt strictly after `after`, and
// meta.nextCursor = the last one's createdAt while a page comes back full
// (null once it doesn't). A single call is therefore a thread's FIRST 50
// messages — reading the newest means following the cursor to the end.

// A safety stop for a server that never stops returning cursors — 5,000
// messages at 50 a page, far beyond any one seat's chat.
export const CHAT_HISTORY_MAX_PAGES = 100;

/**
 * A cursor 1 ms earlier than `iso`. The server's cursor is a createdAt, not
 * a unique key, and it pages strictly after it: a second message stamped in
 * the same millisecond as the page's last one would be skipped. Re-reading
 * that millisecond costs a duplicate or two, which merging by id drops.
 */
export function overlapCursor(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms - 1).toISOString() : iso;
}

interface FetchChatHistoryOptions {
  // Only messages created after this — omit for the whole thread. Read with
  // a 1 ms overlap (see overlapCursor), so messages from its own millisecond
  // come back too.
  after?: string;
  // Checked between pages: stop early (resolving null) once the caller no
  // longer wants the result.
  isCancelled?: () => boolean;
  maxPages?: number;
}

/**
 * Every message of a thread (or every one from `after` on), oldest first,
 * following the server's cursor until it runs out. Null if cancelled.
 */
export async function fetchChatHistory(
  fetchPage: (after: string | undefined) => Promise<ChatMessagesResult>,
  { after, isCancelled, maxPages = CHAT_HISTORY_MAX_PAGES }: FetchChatHistoryOptions = {},
): Promise<ChatMessage[] | null> {
  const byId = new Map<string, ChatMessage>();
  let cursor = after !== undefined ? overlapCursor(after) : undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchPage(cursor);
    if (isCancelled?.()) return null;

    let added = 0;
    for (const message of result.data) {
      if (!byId.has(message.id)) added += 1;
      byId.set(message.id, message);
    }
    const nextCursor = result.meta?.nextCursor ?? null;
    // No progress (a page of nothing but already-seen messages) means the
    // cursor can't move any further either.
    if (!nextCursor || added === 0) break;
    cursor = overlapCursor(nextCursor);
  }

  // May include messages from `after`'s own millisecond (the overlap) that
  // the caller already has — merging by id (mergeChatMessages) drops those.
  return sortByCreatedAt([...byId.values()]);
}

// Stable (Array.prototype.sort is), so messages stamped in the same
// millisecond keep their arrival order.
function sortByCreatedAt<T extends Pick<ChatMessage, 'createdAt'>>(messages: T[]): T[] {
  return [...messages].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/**
 * Merges server messages into the thread on screen: each replaces the entry
 * with its id (a pending one included — the server's copy is the truth), new
 * ones join, and the result is in createdAt order — history pages, socket
 * messages and catch-ups can land in any order.
 */
export function mergeChatMessages<T extends ChatMessage>(current: T[], incoming: ChatMessage[]): (T | ChatMessage)[] {
  if (incoming.length === 0) return current;
  const incomingById = new Map(incoming.map((message) => [message.id, message]));
  const merged: (T | ChatMessage)[] = current.map((message) => incomingById.get(message.id) ?? message);
  const present = new Set(current.map((message) => message.id));
  for (const message of incoming) {
    if (!present.has(message.id)) merged.push(message);
  }
  return sortByCreatedAt(merged);
}

/**
 * The newest createdAt the server stamped on anything in this thread — where
 * a catch-up resumes from. Messages still pending or failed are skipped:
 * their createdAt is this device's clock, not the server's.
 */
export function newestServerCreatedAt(messages: (ChatMessage & { pending?: boolean; failed?: boolean })[]): string | null {
  let newest: string | null = null;
  let newestMs = -Infinity;
  for (const message of messages) {
    if (message.pending || message.failed) continue;
    const ms = Date.parse(message.createdAt);
    if (Number.isFinite(ms) && ms > newestMs) {
      newestMs = ms;
      newest = message.createdAt;
    }
  }
  return newest;
}
