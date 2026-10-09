import type { StyleProp, TextStyle } from 'react-native';
import { AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';
import { useNow } from '../../../hooks/useNow';
import { waitedAtStopMs, type ServerClock } from '../../trips/driverCockpit/noShow';
import { formatAgo } from './riderTripState';

interface DriverArrivedAgoProps {
  // The server time the driver first reached the rider's pickup stop
  // (inquiry.pickupStop.arrivedAt).
  arrivedAt: string | null | undefined;
  serverClock: ServerClock | null;
  // Ticks only while on screen (e.g. not on a hidden tab).
  visible: boolean;
  style?: StyleProp<TextStyle>;
}

// "Driver arrived 3 min ago", measured on the server's clock (see
// ServerClock), so a phone whose clock is off still reads it right. Renders
// nothing without a server arrival — the driver hasn't reached the stop, or
// an older backend.
export function DriverArrivedAgo({ arrivedAt, serverClock, visible, style }: DriverArrivedAgoProps) {
  const { colors } = useTheme();
  const now = useNow(visible && !!arrivedAt && !!serverClock);
  const waited = waitedAtStopMs(arrivedAt, serverClock, now);
  if (waited === null) return null;

  return (
    <AppText variant="label" color={colors.success} style={style}>
      Driver arrived {formatAgo(waited)}
    </AppText>
  );
}
