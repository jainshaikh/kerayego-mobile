import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { NormalizedApiError } from '../../api/errors';
import { usersApi } from '../../api/users.api';
import { useAuth } from '../../auth/auth-context';
import { IDENTITY_HOLD_MESSAGE, identityHoldNotice, isIdentityHoldError } from './identityHold';

export interface IdentityHoldState {
  /** GET /users/me says the account is on hold (falls back to the signed-in user). */
  onHold: boolean;
  /** The message to show in a hold banner, or null for no banner. */
  notice: string | null;
  /**
   * The server's message from an action just refused for the hold, or null.
   * A form whose errors show near its submit button can show the banner
   * there for this, and the `notice` one at the top only while this is null.
   */
  refusedMessage: string | null;
  /**
   * Call with a failed action's error. For a 403 IDENTITY_ON_HOLD it keeps
   * the server's message for the banner, refreshes /users/me so every hold
   * banner appears, and returns true — show nothing else then. Otherwise
   * returns false and the caller shows the error as usual.
   */
  handleHoldError: (error: NormalizedApiError) => boolean;
  /** Forgets a refused action's message (e.g. when its sheet closes). */
  clearRefusal: () => void;
}

// The account's identity hold, for screens that show the hold banner. Reads
// GET /users/me under the same ['me'] key the edit-profile screen uses, so a
// phone change there (which can start a hold) refreshes it for every screen.
export function useIdentityHold(): IdentityHoldState {
  const { user, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => usersApi.getMe(), enabled: isAuthenticated });
  const [refusedMessage, setRefusedMessage] = useState<string | null>(null);

  const onHold = isAuthenticated && (me.data?.identityHold ?? user?.identityHold ?? false);

  const handleHoldError = useCallback(
    (error: NormalizedApiError) => {
      if (!isIdentityHoldError(error)) return false;
      setRefusedMessage(error.message || IDENTITY_HOLD_MESSAGE);
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      return true;
    },
    [queryClient],
  );

  const clearRefusal = useCallback(() => setRefusedMessage(null), []);

  return {
    onHold,
    notice: identityHoldNotice(onHold, refusedMessage),
    refusedMessage,
    handleHoldError,
    clearRefusal,
  };
}
