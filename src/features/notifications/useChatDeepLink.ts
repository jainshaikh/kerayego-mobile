import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useNavigation } from 'expo-router';

import type { ChatLinkDecision } from './chatDeepLink';

export interface ChatDeepLink {
  // Why the linked chat couldn't be opened — shown in ChatLinkUnavailableSheet.
  notice: string | null;
  dismissNotice: () => void;
}

/**
 * Acts once on a chat deep link carried by the route param `paramName` (its
 * value `requested`): as soon as `decision` stops waiting, either `onOpen`
 * opens the thread or the reason it can't becomes `notice` — then the param
 * is cleared from the route, so the same link tapped again acts again.
 */
export function useChatDeepLink(
  paramName: string,
  requested: string | undefined,
  decision: ChatLinkDecision,
  onOpen: (target: { tripInquiryId: string; otherPartyName: string }) => void,
): ChatDeepLink {
  // This screen's own route (not whichever is focused), typed down to the
  // one call made on it.
  const navigation = useNavigation<{ setParams: (params: Record<string, string | undefined>) => void }>();
  const [notice, setNotice] = useState<string | null>(null);
  const handledRef = useRef<string | null>(null);

  // Reads the newest decision/onOpen without making them effect deps (both
  // are rebuilt every render).
  const settle = useEffectEvent(() => {
    if (decision.kind === 'open') onOpen(decision);
    else if (decision.kind === 'unavailable') setNotice(decision.message);
  });

  const decided = decision.kind !== 'wait';
  useEffect(() => {
    if (!requested) {
      handledRef.current = null;
      return;
    }
    if (!decided || handledRef.current === requested) return;
    handledRef.current = requested;
    settle();
    navigation.setParams({ [paramName]: undefined });
  }, [requested, decided, navigation, paramName]);

  return { notice, dismissNotice: () => setNotice(null) };
}
