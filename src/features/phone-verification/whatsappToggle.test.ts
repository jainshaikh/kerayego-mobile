import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { MutationObserver, QueryClient } from '@tanstack/react-query';

import { Role, UserStatus } from '../../types/enums';
import type { User } from '../../types/api.types';
import { ME_QUERY_KEY, whatsappUpdatesMutationOptions } from './whatsappToggle';

function me(whatsappUpdates: boolean): User {
  return {
    id: 'u1',
    name: 'Ali',
    email: 'ali@example.com',
    phone: '+923001234567',
    role: Role.USER,
    status: UserStatus.ACTIVE,
    emailVerified: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    phoneVerified: true,
    mustVerifyPhone: false,
    whatsappUpdates,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Every QueryClient made here, cleared after each test so no garbage-collection
// timer outlives it.
const clients: QueryClient[] = [];
function newClient(): QueryClient {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } });
  clients.push(client);
  return client;
}

afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
});

// Runs the real mutation lifecycle (onMutate → mutationFn → onError/onSuccess)
// through React Query's own MutationObserver — no rendering needed.
function setup() {
  const queryClient = newClient();
  queryClient.setQueryData(ME_QUERY_KEY, me(true));
  const save = deferred<User>();
  const saveFn = jest.fn((_value: boolean) => save.promise);
  const onSaved = jest.fn();
  const observer = new MutationObserver(queryClient, whatsappUpdatesMutationOptions(queryClient, saveFn, onSaved));
  const cached = () => queryClient.getQueryData<User>(ME_QUERY_KEY)?.whatsappUpdates;
  return { queryClient, save, saveFn, onSaved, observer, cached };
}

// Lets onMutate's await settle.
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('the "WhatsApp updates" toggle save', () => {
  it('flips the cached user at once, before the server answers', async () => {
    const { observer, save, saveFn, cached } = setup();
    const done = observer.mutate(false);
    await flush();
    expect(cached()).toBe(false);
    expect(saveFn.mock.calls[0]?.[0]).toBe(false);
    save.resolve(me(false));
    await done;
  });

  it('rolls back to the previous value when the save fails', async () => {
    const { observer, save, onSaved, cached } = setup();
    const done = observer.mutate(false).catch((e: unknown) => e);
    await flush();
    expect(cached()).toBe(false);

    save.reject(new Error('offline'));
    await expect(done).resolves.toBeInstanceOf(Error);
    expect(cached()).toBe(true);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("keeps the server's user on success and hands it on", async () => {
    const { observer, save, onSaved, cached } = setup();
    const done = observer.mutate(false);
    const saved = { ...me(false), updatedAt: '2026-11-01T00:00:00.000Z' };
    save.resolve(saved);
    await done;
    expect(cached()).toBe(false);
    expect(onSaved).toHaveBeenCalledWith(saved);
  });

  it('does nothing to an empty cache, and still saves', async () => {
    const queryClient = newClient();
    const saveFn = jest.fn(async (value: boolean) => me(value));
    const observer = new MutationObserver(queryClient, whatsappUpdatesMutationOptions(queryClient, saveFn, () => {}));
    await observer.mutate(false);
    expect(saveFn.mock.calls[0]?.[0]).toBe(false);
    expect(queryClient.getQueryData<User>(ME_QUERY_KEY)?.whatsappUpdates).toBe(false);
  });
});
