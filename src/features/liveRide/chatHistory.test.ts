import { describe, expect, it, jest } from '@jest/globals';

import type { ChatMessage, ChatMessagesResult } from '../../api/trip-inquiries.api';
import { fetchChatHistory, mergeChatMessages, newestServerCreatedAt, overlapCursor } from './chatHistory';

const T0 = Date.UTC(2026, 9, 9, 8, 0, 0);
const PAGE = 50;

function message(n: number, atMs = T0 + n * 1000, senderId = n % 2 ? 'driver' : 'rider'): ChatMessage {
  return {
    id: `m${n}`,
    tripInquiryId: 'inq-1',
    senderId,
    body: `message ${n}`,
    createdAt: new Date(atMs).toISOString(),
    deliveredAt: null,
    readAt: null,
  };
}

// TripInquiriesService.getMessages, exactly: createdAt strictly after
// `after`, oldest first, take 50, nextCursor = last createdAt when full.
function fakeServer(all: ChatMessage[]) {
  return jest.fn(async (after: string | undefined): Promise<ChatMessagesResult> => {
    const afterMs = after !== undefined ? Date.parse(after) : -Infinity;
    const page = [...all]
      .filter((m) => Date.parse(m.createdAt) > afterMs)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
      .slice(0, PAGE);
    return { data: page, meta: { limit: PAGE, nextCursor: page.length === PAGE ? page[page.length - 1].createdAt : null } };
  });
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => message(from + i));

describe('fetchChatHistory', () => {
  it('reads a thread longer than one page all the way to its newest message', async () => {
    const all = range(1, 120);
    const server = fakeServer(all);
    const history = await fetchChatHistory(server);
    expect(history?.map((m) => m.id)).toEqual(all.map((m) => m.id));
    expect(history?.[history.length - 1].id).toBe('m120');
    expect(server).toHaveBeenCalledTimes(3);
  });

  it('makes one call for a short thread', async () => {
    const server = fakeServer(range(1, 7));
    expect((await fetchChatHistory(server))?.length).toBe(7);
    expect(server).toHaveBeenCalledTimes(1);
    expect(server).toHaveBeenCalledWith(undefined);
  });

  it('stops after the empty page that follows an exactly-full one', async () => {
    const server = fakeServer(range(1, 50));
    expect((await fetchChatHistory(server))?.length).toBe(50);
    expect(server).toHaveBeenCalledTimes(2);
  });

  it('keeps a message stamped in the same millisecond as a page’s last one', async () => {
    // m50 and m51 share a millisecond across the page boundary — a cursor
    // used exactly as given ("strictly after m50") would skip m51.
    const all = range(1, 50);
    all.push(message(51, Date.parse(all[49].createdAt)));
    all.push(message(52));
    const history = await fetchChatHistory(fakeServer(all));
    expect(history?.map((m) => m.id)).toEqual(all.map((m) => m.id));
  });

  it('catches up from `after` without dropping a same-millisecond message', async () => {
    const all = range(1, 10);
    all.push(message(11, Date.parse(all[9].createdAt)));
    all.push(message(12));
    const server = fakeServer(all);
    const missed = await fetchChatHistory(server, { after: all[9].createdAt });
    // m10 itself comes back too (the overlap) — merging by id drops it.
    expect(missed?.map((m) => m.id)).toEqual(['m10', 'm11', 'm12']);
    expect(server).toHaveBeenCalledWith(overlapCursor(all[9].createdAt));
  });

  it('stops when a page brings nothing new', async () => {
    // A misbehaving server that keeps returning the same full page.
    const page = range(1, PAGE);
    const server = jest.fn(
      async (): Promise<ChatMessagesResult> => ({ data: page, meta: { limit: PAGE, nextCursor: page[PAGE - 1].createdAt } }),
    );
    expect((await fetchChatHistory(server))?.length).toBe(PAGE);
    expect(server).toHaveBeenCalledTimes(2);
  });

  it('stops at the page cap', async () => {
    const server = fakeServer(range(1, 500));
    // 50, then 49 new per page — each later page re-reads its cursor message.
    expect((await fetchChatHistory(server, { maxPages: 3 }))?.length).toBe(148);
    expect(server).toHaveBeenCalledTimes(3);
  });

  it('gives up with null once cancelled', async () => {
    let cancelled = false;
    const server = fakeServer(range(1, 200));
    server.mockImplementationOnce(async () => {
      cancelled = true;
      return { data: range(1, 50), meta: { limit: PAGE, nextCursor: message(50).createdAt } };
    });
    expect(await fetchChatHistory(server, { isCancelled: () => cancelled })).toBeNull();
    expect(server).toHaveBeenCalledTimes(1);
  });

  it('copes with a response without meta', async () => {
    const server = jest.fn(async () => ({ data: range(1, 3) }) as unknown as ChatMessagesResult);
    expect((await fetchChatHistory(server))?.length).toBe(3);
  });

  it('passes a failure through', async () => {
    const server = jest.fn(async (): Promise<ChatMessagesResult> => {
      throw new Error('offline');
    });
    await expect(fetchChatHistory(server)).rejects.toThrow('offline');
  });
});

describe('overlapCursor', () => {
  it('moves the cursor 1 ms earlier', () => {
    expect(overlapCursor('2026-10-09T08:00:00.000Z')).toBe('2026-10-09T07:59:59.999Z');
  });

  it('leaves an unparsable cursor alone', () => {
    expect(overlapCursor('not-a-date')).toBe('not-a-date');
  });
});

describe('mergeChatMessages', () => {
  it('adds new messages in createdAt order and replaces known ones by id', () => {
    const current = [message(1), message(3)];
    const updated = { ...message(3), readAt: message(4).createdAt };
    const merged = mergeChatMessages(current, [message(2), updated]);
    expect(merged.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
    expect(merged[2].readAt).toBe(updated.readAt);
  });

  it('replaces a pending local copy with the server’s', () => {
    const pending = { ...message(2), pending: true };
    const merged = mergeChatMessages([message(1), pending], [message(2)]);
    expect(merged).toEqual([message(1), message(2)]);
  });

  it('returns the same list when there is nothing to merge', () => {
    const current = [message(1)];
    expect(mergeChatMessages(current, [])).toBe(current);
  });
});

describe('newestServerCreatedAt', () => {
  it('skips pending and failed messages, whose times are the device’s', () => {
    const list = [message(1), message(2), { ...message(9), pending: true }, { ...message(8), failed: true }];
    expect(newestServerCreatedAt(list)).toBe(message(2).createdAt);
  });

  it('is null for an empty thread', () => {
    expect(newestServerCreatedAt([])).toBeNull();
  });
});
