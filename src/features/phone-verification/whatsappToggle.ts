import type { QueryClient, UseMutationOptions } from '@tanstack/react-query';

import type { User } from '../../types/api.types';
import { withWhatsappUpdates } from './phoneVerification';

// GET /users/me's query key — shared with the profile screens and useIdentityHold.
export const ME_QUERY_KEY = ['me'] as const;

export interface WhatsappToggleContext {
  previous: User | undefined;
}

/**
 * The "WhatsApp updates" save (PATCH /users/me { whatsappUpdates } via
 * `save`), optimistic: the ['me'] cache flips at once and goes back to what
 * it was if the save fails. A successful save replaces it with the server's
 * user and hands that to `onSaved` (the auth context's copy). No API or
 * auth imports here, so it is unit-tested on its own (whatsappToggle.test.ts).
 */
export function whatsappUpdatesMutationOptions(
  queryClient: QueryClient,
  save: (whatsappUpdates: boolean) => Promise<User>,
  onSaved: (user: User) => void,
): UseMutationOptions<User, unknown, boolean, WhatsappToggleContext> {
  return {
    mutationFn: save,
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: ME_QUERY_KEY });
      const previous = queryClient.getQueryData<User>(ME_QUERY_KEY);
      if (previous) queryClient.setQueryData<User>(ME_QUERY_KEY, withWhatsappUpdates(previous, next));
      return { previous };
    },
    onError: (_error, _next, context) => {
      if (context?.previous) queryClient.setQueryData<User>(ME_QUERY_KEY, context.previous);
    },
    onSuccess: (user) => {
      queryClient.setQueryData<User>(ME_QUERY_KEY, user);
      onSaved(user);
    },
  };
}
