import { useEffect, useRef, useState } from 'react';
import { BackHandler, Linking, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Location from 'expo-location';
import * as Crypto from 'expo-crypto';

import { useTripInquiry, useUpdateTripInquiryStatus } from '../../../features/trip-inquiries/queries';
import { useRecordTripEvent } from '../../../features/trips/queries';
import { useOfflineTripQueue } from '../../../features/trips/offlineSync';
import { useRideSocket } from '../../../features/liveRide/socket';
import { geoApi } from '../../../api/geo.api';
import { LiveTripMap, type LiveTripStop } from '../../../features/liveRide/components/LiveTripMap';
import { ChatSheet } from '../../../features/liveRide/components/ChatSheet';
import { AppButton, AppCard, AppScreen, AppText, ErrorState, LoadingState, StatusBadge } from '../../../components/ui';
import { useTheme } from '../../../theme';
import { tripInquiryStatusMeta, tripInquiryRiderActions, PickupSource, TripEventType, TripInquiryStatus, TripStatus } from '../../../types/enums';
import { formatPrice, titleCase } from '../../../utils/format';
import { normalizeApiError } from '../../../api/errors';

// Rider must be within this many meters of a stop for the geofence-gated
// arrival/completion buttons below to enable — mirrors the backend's check.
const GEOFENCE_RADIUS_M = 100;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// Same great-circle formula as the backend's geofence check. Inlined rather
// than shared — this is a separate app/repo from rental-marketplace-backend.
function haversineDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default function MyTripRequestDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, spacing, radii } = useTheme();
  const { data: inquiry, isLoading, isError, refetch } = useTripInquiry(id);
  const updateStatus = useUpdateTripInquiryStatus();
  // Bound to '' while the inquiry hasn't loaded yet — never actually used
  // until after the loading/error guard below, by which point inquiry.trip.id
  // is real. Hooks must still be called unconditionally on every render.
  const recordEvent = useRecordTripEvent(inquiry?.trip.id ?? '');
  const offlineQueue = useOfflineTripQueue(inquiry?.trip.id);
  const { isConnected, isReady, joinTrip, leaveTrip, onLocationUpdate } = useRideSocket();
  const [actionError, setActionError] = useState<string | null>(null);
  const [position, setPosition] = useState<Location.LocationObject | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [actioningType, setActioningType] = useState<TripEventType | null>(null);
  // This screen represents exactly one inquiry (the rider's own), so a
  // single boolean — not a per-inquiry id like the driver's manifest — is
  // enough to track whether its one chat thread is open.
  const [chatOpen, setChatOpen] = useState(false);
  // Driver's live position, received via the socket — never produced locally
  // (the rider never emits, only the driver is authorized to).
  const [driverPosition, setDriverPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [driverLastUpdateAt, setDriverLastUpdateAt] = useState<string | null>(null);
  // The trip's fixed pickup→dropoff route line, for context only (the rider
  // isn't navigating) — fetched once, not re-fetched as the driver moves.
  const [routePolyline, setRoutePolyline] = useState<{ lat: number; lng: number }[] | undefined>(undefined);
  const hasFetchedRouteRef = useRef(false);

  // Foreground-only location watch, active only while the trip is actually
  // running for this rider's confirmed seat — mirrors the condition already
  // used below to show the "Trip status" card.
  const tripLive = inquiry?.status === TripInquiryStatus.ACCEPTED && inquiry?.trip.status === TripStatus.IN_PROGRESS;

  useEffect(() => {
    if (!tripLive) return;

    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (status !== 'granted') {
        setLocationDenied(true);
        return;
      }
      setLocationDenied(false);
      const sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 4000, distanceInterval: 10 },
        (loc) => setPosition(loc),
      );
      if (cancelled) {
        sub.remove();
        return;
      }
      subscription = sub;
    })();

    // Clears any last-known fix once the trip stops being live (seat
    // cancelled, trip ended, or this screen unmounts) — the geofence-gated
    // buttons above never trust a reading from a watch that's no longer running.
    return () => {
      cancelled = true;
      subscription?.remove();
      setPosition(null);
    };
  }, [tripLive]);

  // Joins the same live-ride socket room the driver joins, once the shared
  // socket is ready (it may not be yet on first mount) — leaves again as
  // soon as the trip stops being live or this screen unmounts. The rider
  // only ever listens here; it never calls emitLocation (the server would
  // reject it anyway — only the trip's driver is authorized to emit).
  useEffect(() => {
    const tripId = inquiry?.trip.id;
    if (!tripLive || !isReady || !tripId) return;

    let cancelled = false;
    joinTrip(tripId).then((result) => {
      if (!cancelled && !result.ok) {
        console.warn('[LiveRide] rider joinTrip failed:', result.error);
      }
    });

    return () => {
      cancelled = true;
      leaveTrip(tripId);
    };
    // joinTrip/leaveTrip omitted deliberately: useRideSocket() returns a new
    // function identity every render (it reads live module state, not a
    // stale closure), so including them would tear down/rejoin on every
    // render instead of only when tripLive/isReady/the trip id changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripLive, isReady, inquiry?.trip.id]);

  // Maintains the driver's last-known position from the socket while the
  // trip is live — cleared on cleanup so a stale dot never lingers once the
  // ride stops being live or this screen unmounts.
  useEffect(() => {
    if (!tripLive) return;
    const tripId = inquiry?.trip.id;

    const unsubscribe = onLocationUpdate((payload) => {
      if (payload.tripId !== tripId) return;
      setDriverPosition({ lat: payload.lat, lng: payload.lng });
      setDriverLastUpdateAt(new Date(payload.ts).toISOString());
    });

    return () => {
      unsubscribe();
      setDriverPosition(null);
      setDriverLastUpdateAt(null);
    };
    // onLocationUpdate omitted deliberately — same reasoning as the
    // join/leave effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripLive, inquiry?.trip.id]);

  // Fetches the trip's whole pickup→dropoff route line ONCE, the first time
  // the trip is live — this is just map context for the rider (who isn't
  // navigating), so it's never re-fetched as the driver's position updates.
  // hasFetchedRouteRef guards the actual network call so remounts/refetches
  // of `inquiry` (e.g. after handleRiderEvent's refetch()) can't trigger it
  // again. A failed call or "no route" response just leaves the map without
  // a route line — never a crash, never something that blocks ride actions.
  useEffect(() => {
    const pickup = inquiry?.pickupStop;
    const dropoff = inquiry?.dropoffStop;
    if (!tripLive || !pickup || !dropoff || hasFetchedRouteRef.current) return;
    hasFetchedRouteRef.current = true;

    let cancelled = false;
    geoApi
      .getRouteDirections({ lat: pickup.lat, lng: pickup.lng }, { lat: dropoff.lat, lng: dropoff.lng })
      .then((directions) => {
        if (!cancelled) setRoutePolyline(directions.polyline);
      })
      .catch(() => {
        // Nice-to-have overlay only — silently leave routePolyline unset.
      });

    return () => {
      cancelled = true;
    };
  }, [tripLive, inquiry?.pickupStop, inquiry?.dropoffStop]);

  // Locks the rider into this screen while the trip is live: the hardware
  // back button is swallowed instead of navigating away, released again the
  // instant the trip is no longer live or this screen unmounts.
  useEffect(() => {
    if (!tripLive) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, [tripLive]);

  if (isLoading) return <LoadingState label="Loading request..." />;
  if (isError || !inquiry) return <ErrorState message="Couldn't load this request." onRetry={refetch} />;

  const availableActions = tripInquiryRiderActions(inquiry.status);

  const handleCancel = async () => {
    setActionError(null);
    try {
      await updateStatus.mutateAsync({ id: id as string, data: { newStatus: TripInquiryStatus.CANCELLED } });
    } catch (error) {
      setActionError(normalizeApiError(error).message);
    }
  };

  const pickupStop = inquiry.pickupStop;
  const dropoffStop = inquiry.dropoffStop;
  // pickupStop/dropoffStop carry no `type` field of their own (unlike
  // ManifestRouteStop on the driver side), so it's added here to satisfy
  // LiveTripMap's LiveTripStop shape.
  const liveStops: LiveTripStop[] = [
    pickupStop ? { id: pickupStop.id, type: 'PICKUP' as const, label: pickupStop.label, lat: pickupStop.lat, lng: pickupStop.lng } : null,
    dropoffStop ? { id: dropoffStop.id, type: 'DROPOFF' as const, label: dropoffStop.label, lat: dropoffStop.lat, lng: dropoffStop.lng } : null,
  ].filter((stop): stop is LiveTripStop => stop !== null);
  const pickupDistanceM = position && pickupStop ? haversineDistanceMeters(position.coords.latitude, position.coords.longitude, pickupStop.lat, pickupStop.lng) : null;
  const dropoffDistanceM = position && dropoffStop ? haversineDistanceMeters(position.coords.latitude, position.coords.longitude, dropoffStop.lat, dropoffStop.lng) : null;

  const showArriveButton = !inquiry.pickupConfirmedAt && inquiry.trip.status === TripStatus.IN_PROGRESS && pickupStop !== null;
  const canArrive = pickupDistanceM !== null && pickupDistanceM <= GEOFENCE_RADIUS_M;
  const arriveDisabledReason = locationDenied
    ? 'Enable location access to confirm your arrival.'
    : !position
      ? 'Waiting for your location…'
      : 'Move within 100m of your pickup point to confirm arrival.';

  const showCompleteButton =
    !inquiry.droppedOffAt && (inquiry.trip.status === TripStatus.IN_PROGRESS || inquiry.trip.status === TripStatus.COMPLETED);
  const canComplete = !dropoffStop || (dropoffDistanceM !== null && dropoffDistanceM <= GEOFENCE_RADIUS_M);
  const completeDisabledReason = locationDenied
    ? 'Enable location access to complete the ride.'
    : !position
      ? 'Waiting for your location…'
      : 'Move within 100m of your drop-off point to complete the ride.';

  const handleRiderEvent = async (type: typeof TripEventType.ARRIVED | typeof TripEventType.DROPOFF) => {
    setActionError(null);
    setActioningType(type);
    const eventId = Crypto.randomUUID();
    const occurredAt = new Date().toISOString();
    const coords = position?.coords ?? null;
    const eventPayload = {
      id: eventId,
      tripInquiryId: inquiry.id,
      type,
      occurredAt,
      payload: {
        lat: coords?.latitude ?? null,
        lng: coords?.longitude ?? null,
        accuracyM: coords?.accuracy ?? null,
        isMockLocation: position?.mocked ?? false,
      },
    };
    try {
      await recordEvent.mutateAsync(eventPayload);
      await refetch();
    } catch (error) {
      const normalized = normalizeApiError(error);
      if (normalized.kind === 'network') {
        await offlineQueue.enqueue({
          id: eventId,
          kind: 'event',
          tripId: inquiry.trip.id,
          queuedAt: occurredAt,
          payload: eventPayload,
        });
      } else {
        setActionError(normalized.message);
      }
    } finally {
      setActioningType(null);
    }
  };

  return (
    <AppScreen edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: 'Trip request' }} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <AppText variant="title" style={{ flex: 1, marginRight: spacing.md, textTransform: 'capitalize' }}>
            {titleCase(inquiry.trip.originCity)} → {titleCase(inquiry.trip.destinationCity)}
          </AppText>
          <StatusBadge label={tripInquiryStatusMeta[inquiry.status].label} tone={tripInquiryStatusMeta[inquiry.status].tone} />
        </View>
        <AppText muted style={{ marginTop: spacing.xs }}>
          {inquiry.trip.postedBy.name}
        </AppText>

        <AppCard style={{ marginTop: spacing.lg }}>
          <Row label="Departure" value={new Date(inquiry.trip.departureAt).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })} />
          <Row label="Seats requested" value={String(inquiry.requestedSeats)} />
          <Row label="Pickup point" value={inquiry.trip.pickupPoint} />
          {inquiry.pickupNote ? <Row label="Your note" value={inquiry.pickupNote} /> : null}
          <Row label="Price / seat" value={formatPrice(inquiry.trip.pricePerSeat)} />
        </AppCard>

        {inquiry.message ? (
          <AppCard style={{ marginTop: spacing.lg }}>
            <AppText variant="label">Your message</AppText>
            <AppText muted style={{ marginTop: spacing.xs }}>
              {inquiry.message}
            </AppText>
          </AppCard>
        ) : null}

        {inquiry.status === 'ACCEPTED' ? (
          <AppCard style={{ marginTop: spacing.lg, borderColor: colors.success }}>
            <AppText variant="label" color={colors.success}>
              Accepted!
            </AppText>
            <AppText muted style={{ marginTop: spacing.xs }}>
              Contact {inquiry.trip.postedBy.name} to confirm pickup details.
            </AppText>
            <AppButton
              title="Contact via WhatsApp"
              variant="secondary"
              style={{ marginTop: spacing.md }}
              onPress={() => {
                // wa.me requires digits only — no leading '+', spaces, or dashes.
                const number = inquiry.trip.contactNumber.replace(/\D/g, '');
                Linking.openURL(`https://wa.me/${number}`).catch(() => {});
              }}
            />
            {/* Chat is available as soon as the request is accepted — not
                gated on the trip being IN_PROGRESS, since riders often need
                to coordinate pickup details before the ride physically starts. */}
            <AppButton
              title="Chat with driver"
              variant="secondary"
              style={{ marginTop: spacing.sm }}
              onPress={() => setChatOpen(true)}
            />
          </AppCard>
        ) : null}

        {inquiry.status === 'ACCEPTED' && inquiry.trip.status !== TripStatus.ACTIVE ? (
          <AppCard style={{ marginTop: spacing.lg }}>
            <AppText variant="label" style={{ marginBottom: spacing.xs }}>
              Trip status
            </AppText>
            {inquiry.droppedOffAt ? (
              <AppText muted variant="caption">
                {inquiry.pickupSource === PickupSource.AUTO_ON_TRIP_END
                  ? 'Trip completed.'
                  : `You were dropped off at ${formatTime(inquiry.droppedOffAt)}.`}
              </AppText>
            ) : inquiry.pickupConfirmedAt ? (
              <AppText muted variant="caption">
                You&apos;re on the trip — picked up at {formatTime(inquiry.pickupConfirmedAt)}.
              </AppText>
            ) : inquiry.trip.status === TripStatus.IN_PROGRESS ? (
              <AppText muted variant="caption">
                Your driver has started the trip.
              </AppText>
            ) : (
              <AppText muted variant="caption">
                Trip completed.
              </AppText>
            )}
          </AppCard>
        ) : null}

        {tripLive ? (
          <View style={{ marginTop: spacing.lg, height: 260, borderRadius: radii.card, overflow: 'hidden' }}>
            <LiveTripMap
              stops={liveStops}
              driverPosition={driverPosition}
              isConnected={isConnected}
              lastUpdateAt={driverLastUpdateAt}
              routePolyline={routePolyline}
            />
          </View>
        ) : null}

        {showArriveButton || showCompleteButton ? (
          <AppCard style={{ marginTop: spacing.lg }}>
            <AppText variant="label" style={{ marginBottom: spacing.sm }}>
              Ride actions
            </AppText>

            {showArriveButton ? (
              <View style={{ marginBottom: showCompleteButton ? spacing.md : 0 }}>
                <AppButton
                  title="I've arrived"
                  loading={actioningType === TripEventType.ARRIVED}
                  disabled={!canArrive || actioningType !== null}
                  onPress={() => handleRiderEvent(TripEventType.ARRIVED)}
                />
                {!canArrive ? (
                  <AppText muted variant="caption" style={{ marginTop: spacing.xs }}>
                    {arriveDisabledReason}
                  </AppText>
                ) : null}
              </View>
            ) : null}

            {showCompleteButton ? (
              <View>
                <AppButton
                  title="Complete ride"
                  variant={showArriveButton ? 'secondary' : 'primary'}
                  loading={actioningType === TripEventType.DROPOFF}
                  disabled={!canComplete || actioningType !== null}
                  onPress={() => handleRiderEvent(TripEventType.DROPOFF)}
                />
                {!canComplete ? (
                  <AppText muted variant="caption" style={{ marginTop: spacing.xs }}>
                    {completeDisabledReason}
                  </AppText>
                ) : null}
              </View>
            ) : null}
          </AppCard>
        ) : null}

        {inquiry.status === 'REJECTED' && inquiry.rejectionReason ? (
          <AppCard style={{ marginTop: spacing.lg }}>
            <AppText variant="label">Note from the driver</AppText>
            <AppText muted style={{ marginTop: spacing.xs }}>
              {inquiry.rejectionReason}
            </AppText>
          </AppCard>
        ) : null}

        {actionError ? (
          <AppText color={colors.danger} style={{ marginTop: spacing.md }}>
            {actionError}
          </AppText>
        ) : null}

        {availableActions.includes(TripInquiryStatus.CANCELLED) ? (
          <AppButton
            title={inquiry.status === 'ACCEPTED' ? 'Cancel my seat' : 'Cancel request'}
            variant="danger"
            loading={updateStatus.isPending}
            onPress={handleCancel}
            style={{ marginTop: spacing.xl }}
          />
        ) : null}
      </ScrollView>

      <ChatSheet
        visible={chatOpen}
        onClose={() => setChatOpen(false)}
        tripInquiryId={inquiry.id}
        otherPartyName={inquiry.trip.postedBy.name}
      />
    </AppScreen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const { spacing } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs }}>
      <AppText muted variant="caption">
        {label}
      </AppText>
      <AppText variant="caption">{value}</AppText>
    </View>
  );
}
