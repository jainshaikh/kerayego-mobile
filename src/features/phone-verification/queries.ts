import { useMutation, useQueryClient } from '@tanstack/react-query';

import { usersApi } from '../../api/users.api';
import { useAuth } from '../../auth/auth-context';
import { whatsappUpdatesMutationOptions } from './whatsappToggle';

/** The "WhatsApp updates" switch's save — optimistic with rollback. */
export function useWhatsappUpdatesToggle() {
  const queryClient = useQueryClient();
  const { replaceUser } = useAuth();
  return useMutation(
    whatsappUpdatesMutationOptions(queryClient, (whatsappUpdates) => usersApi.updateMe({ whatsappUpdates }), replaceUser),
  );
}
