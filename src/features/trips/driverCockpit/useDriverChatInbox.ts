import { useEffect, useState } from 'react';
import { useRideSocket } from '../../liveRide/socket';

export interface ChatTarget {
  id: string;
  name: string;
}

export interface DriverChatInbox {
  chatTarget: ChatTarget | null;
  unreadCounts: Record<string, number>;
  openChat: (riderId: string, riderName: string) => void;
  closeChat: () => void;
}

/**
 * Tracks which accepted rider's chat thread is open (a single slot — only one
 * ChatPanel is ever mounted/joined at a time, per the design spec) and
 * per-rider unread counts for the Riders tab's "Chat · N" badges. Counts are
 * local/presentational only: they reset to 0 the moment a thread is opened
 * and are never persisted or backfilled from history on mount.
 */
export function useDriverChatInbox(currentUserId: string | undefined): DriverChatInbox {
  const { onChatMessage } = useRideSocket();
  const [chatTarget, setChatTarget] = useState<ChatTarget | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});

  // Increments a rider's unread chat count whenever a chat.message arrives
  // for their thread while it is NOT the thread currently open — opening a
  // thread (see openChat below) resets that rider's count back to 0
  // immediately, so this only ever accumulates for threads the driver isn't
  // currently looking at. Runs for the lifetime of this screen (not gated on
  // trip status), per the design spec's "opening a thread clears its unread
  // count".
  useEffect(() => {
    const unsubscribe = onChatMessage((message) => {
      if (message.senderId === currentUserId) return;
      if (chatTarget && message.tripInquiryId === chatTarget.id) return;
      setUnreadCounts((prev) => ({
        ...prev,
        [message.tripInquiryId]: (prev[message.tripInquiryId] ?? 0) + 1,
      }));
    });
    return unsubscribe;
    // onChatMessage omitted deliberately: useRideSocket() returns a new
    // function identity every render (it reads live module state, not a
    // stale closure), so including it would resubscribe on every render
    // instead of only when chatTarget/currentUserId change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatTarget, currentUserId]);

  // Opens a rider's chat thread and immediately clears its unread count — the
  // single writer of both chatTarget and unreadCounts[riderId] for the
  // "opening a thread clears its unread count" rule.
  const openChat = (riderId: string, riderName: string) => {
    setChatTarget({ id: riderId, name: riderName });
    setUnreadCounts((prev) => (prev[riderId] ? { ...prev, [riderId]: 0 } : prev));
  };

  const closeChat = () => setChatTarget(null);

  return { chatTarget, unreadCounts, openChat, closeChat };
}
