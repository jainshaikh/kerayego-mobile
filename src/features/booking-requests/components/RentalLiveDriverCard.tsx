import { Linking, StyleSheet, View } from 'react-native';

import { AppButton, AppCard, AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';
import { useAppInForeground } from '../../../hooks/useAppInForeground';
import { useNow } from '../../../hooks/useNow';
import { LiveTripMap } from '../../liveRide/components/LiveTripMap';
import { formatAgo } from '../../trip-inquiries/riderLiveTrip/riderTripState';
import { useBookingLiveDriver, useBookingLiveRoute } from '../queries';

interface RentalLiveDriverCardProps {
  bookingId: string;
}

const MAP_HEIGHT = 260;

// The rental customer's view of their assigned driver while the booking is
// IN_PROGRESS: a live map of the driver's last position with their recent
// path (GET /booking-requests/:id/live-driver and /live-route, polled every
// 10 s while this screen is open in the foreground), the driver's name, a
// Call button and when the position was last updated.
export function RentalLiveDriverCard({ bookingId }: RentalLiveDriverCardProps) {
  const { colors, spacing, radii } = useTheme();
  const inForeground = useAppInForeground();
  const { data: live, isError, isLoading } = useBookingLiveDriver(bookingId, inForeground);
  const { data: route } = useBookingLiveRoute(bookingId, inForeground);
  const lastLocation = live?.lastLocation ?? null;
  const updatedAtMs = lastLocation?.timestamp ? Date.parse(lastLocation.timestamp) : Number.NaN;
  const now = useNow(Number.isFinite(updatedAtMs));

  const position = lastLocation ? { lat: lastLocation.lat, lng: lastLocation.lng } : null;
  const driverName = live?.driver?.name ?? 'Your driver';
  const phone = live?.driver?.phone ?? null;
  const pickedUp = !!live?.customerPickedUpAt;

  let updatedLabel: string;
  if (isLoading) updatedLabel = 'Loading the driver’s location…';
  else if (!position) updatedLabel = 'Waiting for the driver’s location';
  else if (Number.isFinite(updatedAtMs)) updatedLabel = `Location updated ${formatAgo(now - updatedAtMs)}`;
  else updatedLabel = 'Location updated';

  return (
    <AppCard style={{ marginTop: spacing.lg, padding: 0, overflow: 'hidden' }}>
      <View style={{ height: MAP_HEIGHT }}>
        <LiveTripMap
          stops={[]}
          driverPosition={position}
          isConnected={!isError}
          lastUpdateAt={lastLocation?.timestamp ?? null}
          routePolyline={route?.map((fix) => ({ lat: fix.lat, lng: fix.lng }))}
          driverLabel="D"
          focus={position ? { points: [position], key: 'driver', follow: true } : undefined}
        />
        {!position && !isError ? (
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { alignItems: 'center', justifyContent: 'center', backgroundColor: `${colors.background}99` },
            ]}
          >
            <AppText
              variant="label"
              style={{
                backgroundColor: colors.surface,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.xs,
                borderRadius: radii.chip,
                overflow: 'hidden',
              }}
            >
              {isLoading ? 'Loading…' : 'No location from the driver yet'}
            </AppText>
          </View>
        ) : null}
      </View>
      <View style={{ padding: spacing.lg }}>
        <AppText muted variant="caption">
          {pickedUp ? 'Your driver · you’re on board' : 'Your driver · on the way to you'}
        </AppText>
        <AppText variant="subtitle" numberOfLines={1}>
          {driverName}
        </AppText>
        <AppText muted variant="caption" style={{ marginTop: 2 }}>
          {updatedLabel}
        </AppText>
        {phone ? (
          <AppButton
            title="Call driver"
            variant="outline"
            onPress={() => Linking.openURL(`tel:${phone.replace(/[^\d+]/g, '')}`).catch(() => {})}
            style={{ marginTop: spacing.md }}
          />
        ) : null}
      </View>
    </AppCard>
  );
}
