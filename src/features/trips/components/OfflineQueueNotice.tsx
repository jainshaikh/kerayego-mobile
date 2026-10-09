import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AppCard, AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';
import type { ApiErrorKind } from '../../../api/errors';
import { OFFLINE_QUEUE_MAX_ATTEMPTS, type DroppedTripAction } from '../../../storage/offline-trip-queue';
import { TripEventType } from '../../../types/enums';
import type { OfflineTripQueue } from '../offlineSync';

// How many discarded actions are listed by name before "+N more".
const MAX_LISTED = 3;

const EVENT_LABELS: Record<TripEventType, string> = {
  [TripEventType.START]: 'Start trip',
  [TripEventType.ARRIVED]: 'Arrival',
  [TripEventType.PICKUP]: 'Pickup',
  [TripEventType.NO_SHOW]: 'No-show',
  [TripEventType.DROPOFF]: 'Drop-off',
  [TripEventType.END]: 'End ride',
};

function actionLabel(entry: DroppedTripAction): string {
  if (entry.kind === 'start') return 'Start trip';
  if (entry.kind === 'end') return 'End ride';
  return (entry.eventType && EVENT_LABELS[entry.eventType]) ?? 'Trip action';
}

function reasonLabel(entry: DroppedTripAction): string {
  if (entry.reason === 'expired') return "it couldn't be sent within 24 hours";
  if (entry.reason === 'max_attempts') return `it still failed after ${OFFLINE_QUEUE_MAX_ATTEMPTS} tries`;
  return entry.message ?? 'the server refused it';
}

function pendingLabel(count: number, lastErrorKind: ApiErrorKind | undefined): string {
  const actions = `${count} action${count !== 1 ? 's' : ''}`;
  // Never tried yet, or no answer at all: the phone is offline.
  if (!lastErrorKind || lastErrorKind === 'network') {
    return `${actions} queued — no connection yet. They'll sync automatically once you're back online.`;
  }
  const them = count !== 1 ? 'them' : 'it';
  return `${actions} waiting to sync — the server couldn't take ${them} yet. Retrying automatically.`;
}

interface OfflineQueueNoticeProps {
  queue: OfflineTripQueue;
  // 'bar': a full-width strip for the fixed-height live layouts; 'card': for
  // the scrolling pre-live views.
  variant?: 'bar' | 'card';
}

// The trip screens' one place for offline-queue status: how many actions
// are still waiting to sync, and a dismissible notice for any the queue had
// to discard (refused by the server, too old, or out of attempts) — the
// screen's optimistic state for those has already rolled back on its own.
export function OfflineQueueNotice({ queue, variant = 'card' }: OfflineQueueNoticeProps) {
  const { colors, tones, spacing, radii } = useTheme();
  const { pendingCount, pendingItems, flushing, droppedActions } = queue;
  if (pendingCount === 0 && droppedActions.length === 0) return null;

  const droppedCount = droppedActions.length;
  const pending =
    pendingCount > 0 ? (
      <AppText variant="caption">
        {flushing ? 'Syncing…' : pendingLabel(pendingCount, pendingItems[0]?.lastErrorKind)}
      </AppText>
    ) : null;

  const dropped =
    droppedCount > 0 ? (
      <View
        accessibilityRole="alert"
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: spacing.sm,
          backgroundColor: tones.danger.bg,
          borderRadius: radii.md,
          padding: spacing.sm,
          marginTop: pending ? spacing.sm : 0,
        }}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText variant="label" color={tones.danger.fg}>
            {droppedCount} offline action{droppedCount !== 1 ? 's' : ''} couldn&apos;t be synced and{' '}
            {droppedCount !== 1 ? 'were' : 'was'} discarded.
          </AppText>
          {droppedActions.slice(0, MAX_LISTED).map((entry) => (
            <AppText key={entry.id} variant="caption" color={tones.danger.fg} style={{ marginTop: 2 }}>
              {actionLabel(entry)}: {reasonLabel(entry)}
            </AppText>
          ))}
          {droppedCount > MAX_LISTED ? (
            <AppText variant="caption" color={tones.danger.fg} style={{ marginTop: 2 }}>
              +{droppedCount - MAX_LISTED} more
            </AppText>
          ) : null}
        </View>
        <Pressable
          onPress={() => {
            queue.dismissDropped();
          }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          style={{ width: 28, height: 28, borderRadius: radii.full, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="close" size={18} color={tones.danger.fg} />
        </Pressable>
      </View>
    ) : null;

  if (variant === 'bar') {
    return (
      <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.surfaceAlt }}>
        {pending}
        {dropped}
      </View>
    );
  }

  return (
    <AppCard style={{ marginTop: spacing.md, backgroundColor: colors.surfaceAlt }}>
      {pending}
      {dropped}
    </AppCard>
  );
}
