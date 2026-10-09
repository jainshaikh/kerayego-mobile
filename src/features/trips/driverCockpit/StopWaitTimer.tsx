import type { StyleProp, TextStyle } from 'react-native';
import { AppText } from '../../../components/ui';
import { useNow } from '../../../hooks/useNow';
import { formatElapsed, waitedAtStopMs, type ServerClock } from './noShow';

interface StopWaitTimerProps {
  // The stop's server-recorded arrival (routeStops[].arrivedAt).
  arrivedAt: string | null | undefined;
  serverClock: ServerClock | null;
  // Ticks only while on screen (e.g. not on a hidden tab).
  visible: boolean;
  style?: StyleProp<TextStyle>;
}

// "Waiting 3:07" since the driver's Reached at a pickup stop, on the server's
// clock (see ServerClock). Renders nothing without a server arrival — an
// arrival still queued offline, or an older backend.
export function StopWaitTimer({ arrivedAt, serverClock, visible, style }: StopWaitTimerProps) {
  const now = useNow(visible && !!arrivedAt && !!serverClock);
  const waited = waitedAtStopMs(arrivedAt, serverClock, now);
  if (waited === null) return null;

  return (
    <AppText muted variant="caption" style={style}>
      Waiting {formatElapsed(waited)}
    </AppText>
  );
}
