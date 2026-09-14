import { useEffect, useRef, useState } from 'react';
import { BackHandler, Linking, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Location from 'expo-location';
import * as Crypto from 'expo-crypto';
import { useQuery } from '@tanstack/react-query';

import {
  useTripInquiry,
  useUpdateTripInquiryStatus,
} from '../../../features/trip-inquiries/queries';
import { useRecordTripEvent } from '../../../features/trips/queries';
import { useOfflineTripQueue } from '../../../features/trips/offlineSync';
import { useRideSocket } from '../../../features/liveRide/socket';
import { geoApi } from '../../../api/geo.api';
import { tripsApi } from '../../../api/trips.api';
import {
  LiveTripMap,
  type LiveTripStop,
} from '../../../features/liveRide/components/LiveTripMap';
import { ChatModalSheet } from '../../../features/liveRide/components/ChatModalSheet';
import {
  AppButton,
  AppCard,
  AppScreen,
  AppText,
  ErrorState,
  LoadingState,
  StatusBadge,
  TabBar,
  type TabBarItem,
} from '../../../components/ui';
import { useTheme } from '../../../theme';
import {
  tripInquiryStatusMeta,
  tripInquiryRiderActions,
  PickupSource,
  TripEventType,
  TripInquiryStatus,
  TripStatus,
} from '../../../types/enums';
import { formatDate, formatPrice, titleCase } from '../../../utils/format';
import { normalizeApiError } from '../../../api/errors';

// Rider must be within this many meters of a stop for the geofence-gated
// arrival/completion buttons below to enable — mirrors the backend's check.
const GEOFENCE_RADIUS_M = 100;

// Live ETA-to-stop fetches (see the effect below) are throttled to at most
// once per this interval, regardless of how often the driver's position
// updates via the socket (~every 4s) — reuses the same route-directions
// endpoint as the one-time whole-route fetch above, just aimed at the
// driver's current (moving) position instead of the fixed pickup point.
const ETA_FETCH_THROTTLE_MS = 45_000;

// Design-spec literal colors (active-ride-rider mockup / active-ride-driver-spec.md
// §4.1/§4.2 conventions) that have no matching theme token — same convention
// LiveTripMap.tsx and my-trips/[id].tsx already use for their own "reached"/avatar colors.
const REACHED_DOT_BG = '#FFDDE2';
const REACHED_DOT_FG = '#C2203C';
const UPCOMING_DOT_BG = '#FFF0F2';
const AVATAR_BG = '#FFF0F2';
const AVATAR_FG = '#C2203C';

type TripLiveTabKey = 'stops' | 'driver' | 'summary';

const TRIP_LIVE_TABS: TabBarItem[] = [
  { key: 'stops', label: 'Stops' },
  { key: 'driver', label: 'Driver' },
  { key: 'summary', label: 'Summary' },
];

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Floors to a never-negative, never-"0 min" display: anything under a minute
// (including a stale/negative reading) reads as "Arriving now" instead.
function formatEtaLabel(minutes: number): string {
  const rounded = Math.round(minutes);
  return rounded < 1 ? 'Arriving now' : `~${rounded} min`;
}

// Same great-circle formula as the backend's geofence check. Inlined rather
// than shared — this is a separate app/repo from kerayego-backend.
function haversineDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6_371_000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Short "value + unit" distance label (no directional suffix) — same
// magnitude logic as utils/format.ts's formatDistance, but without its
// trailing " away" (this screen supplies its own trailing words, e.g.
// "... from you" / "Driver arriving · ...").
function formatDistanceShort(distanceKm: number): string {
  return distanceKm < 1
    ? `${Math.round(distanceKm * 1000)} m`
    : `${distanceKm.toFixed(1)} km`;
}

export default function MyTripRequestDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, spacing, radii, shadows } = useTheme();
  const { data: inquiry, isLoading, isError, refetch } = useTripInquiry(id);
  const updateStatus = useUpdateTripInquiryStatus();
  // Bound to '' while the inquiry hasn't loaded yet — never actually used
  // until after the loading/error guard below, by which point inquiry.trip.id
  // is real. Hooks must still be called unconditionally on every render.
  const recordEvent = useRecordTripEvent(inquiry?.trip.id ?? '');
  const offlineQueue = useOfflineTripQueue(inquiry?.trip.id);
  const { isConnected, isReady, joinTrip, leaveTrip, onLocationUpdate } =
    useRideSocket();
  const [actionError, setActionError] = useState<string | null>(null);
  const [position, setPosition] = useState<Location.LocationObject | null>(
    null,
  );
  const [locationDenied, setLocationDenied] = useState(false);
  const [actioningType, setActioningType] = useState<TripEventType | null>(
    null,
  );
  // Which tab of the tripLive layout is selected — the tab bar itself is
  // tap-only (see TabBar), so this only ever changes via an explicit tap.
  const [activeTab, setActiveTab] = useState<TripLiveTabKey>('stops');
  // Driver's live position, received via the socket — never produced locally
  // (the rider never emits, only the driver is authorized to).
  const [driverPosition, setDriverPosition] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [driverLastUpdateAt, setDriverLastUpdateAt] = useState<string | null>(
    null,
  );
  // The trip's fixed pickup→dropoff route line, for context only (the rider
  // isn't navigating) — fetched once, not re-fetched as the driver moves.
  const [routePolyline, setRoutePolyline] = useState<
    { lat: number; lng: number }[] | undefined
  >(undefined);
  const hasFetchedRouteRef = useRef(false);
  // Live ETA (minutes) from the driver's current position to the rider's
  // next stop — pickup until pickupConfirmedAt is set, dropoff after.
  const [etaMinutes, setEtaMinutes] = useState<number | null>(null);
  // Distance (km) companion to etaMinutes above, read off the SAME
  // route-directions response the throttled effect below already fetches
  // (geoApi.getRouteDirections returns distanceKm alongside durationMinutes
  // in one call) — captured only for the "Driver arriving · {distance}"
  // live-card/banner copy; no separate fetch, no extra throttling.
  const [driverDistanceKm, setDriverDistanceKm] = useState<number | null>(null);
  // Last-fetch timestamp per target, so switching targets (pickup → dropoff)
  // doesn't have to wait out the OTHER target's throttle window.
  const lastEtaFetchAtRef = useRef<{
    pickup: number | null;
    dropoff: number | null;
  }>({ pickup: null, dropoff: null });
  // Whether the RIDER has locally self-confirmed being at their pickup point
  // (mirrors the reference mockup's "atPickup" / this.state.reached). This is
  // DELIBERATELY separate from, and never written back into, the real
  // inquiry.pickupConfirmedAt field — only the DRIVER's own Pickup tap sets
  // that (a rider's self-report never overwrites the driver-authoritative
  // pickup record; see my-trips/[id].tsx's own analogous local-only
  // arrivedStopIds tracking for ARRIVED events, which this mirrors exactly).
  // Purely presentational: it only gates which map-overlay/live-card
  // treatment shows below, never the real geofence-gated action buttons'
  // enablement. Resets on remount, same as every other local-only event flag
  // in this app.
  const [riderConfirmedAtPickup, setRiderConfirmedAtPickup] = useState(false);
  // Whether the driver chat modal (ChatModalSheet, wrapping the existing
  // ChatPanel) is open — chat is a modal now, not a tab.
  const [chatOpen, setChatOpen] = useState(false);

  // Foreground-only location watch, active only while the trip is actually
  // running for this rider's confirmed seat — mirrors the condition already
  // used below to show the "Trip status" card.
  const tripLive =
    inquiry?.status === TripInquiryStatus.ACCEPTED &&
    inquiry?.trip.status === TripStatus.IN_PROGRESS;

  // Full trip route (every pickup/dropoff stop across the whole carpool, not
  // just this rider's own pickupStop/dropoffStop) — powers only the map's
  // de-emphasized "other stops" pins and the Stops tab's "Stops on this ride"
  // overview list, both purely presentational. Reuses the same public
  // trip-detail endpoint already used elsewhere in this app for browsing/
  // booking a trip (tripsApi.getOne) — not a new backend surface. A failed or
  // not-yet-loaded fetch just leaves those two lists empty (see the `?? []`
  // fallbacks below); it never blocks pickup/dropoff, ETA, chat, or cancellation.
  const tripStopsQuery = useQuery({
    queryKey: ['tripStops', inquiry?.trip.id],
    queryFn: () => tripsApi.getOne(inquiry?.trip.id ?? ''),
    enabled: tripLive && !!inquiry?.trip.id,
  });

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
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 4000,
          distanceInterval: 10,
        },
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
      .getRouteDirections(
        { lat: pickup.lat, lng: pickup.lng },
        { lat: dropoff.lat, lng: dropoff.lng },
      )
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

  // Clears the last-known ETA whenever the rider's "next stop" target
  // switches (pickup confirmed → now targeting dropoff; dropped off → no
  // more ETA needed) so a stale pickup-context number never gets relabelled
  // as a dropoff one (or vice versa) while the next real fetch is in flight.
  // Wrapped in an async IIFE — same convention as ChatPanel's history-fetch
  // effect — a bare synchronous setState at the top of an effect body
  // triggers this project's react-hooks/set-state-in-effect lint rule.
  useEffect(() => {
    (async () => {
      setEtaMinutes(null);
      setDriverDistanceKm(null);
    })();
  }, [inquiry?.pickupConfirmedAt, inquiry?.droppedOffAt]);

  // Live ETA from the driver's current position to the rider's next stop —
  // reuses the SAME route-directions call as the one-time whole-route fetch
  // above, but with the origin re-aimed at the driver's live position each
  // time, and re-run periodically as that position updates via the socket.
  //
  // THROTTLING: this effect body re-runs on every driverPosition update from
  // the socket (~every 4s — see the driver-location-listener effect above),
  // but it only issues the actual network call when at least
  // ETA_FETCH_THROTTLE_MS (45s) have passed since the last fetch made FOR
  // THIS SAME TARGET (lastEtaFetchAtRef.current[target]) — every other
  // ~4s tick just re-checks that ref and returns immediately with no
  // network call. This is what keeps the ~4s GPS cadence from turning into
  // an unbounded per-tick API cost.
  useEffect(() => {
    if (!tripLive || !driverPosition || inquiry?.droppedOffAt) return;

    const target: 'pickup' | 'dropoff' = inquiry?.pickupConfirmedAt
      ? 'dropoff'
      : 'pickup';
    const destStop =
      target === 'pickup' ? inquiry?.pickupStop : inquiry?.dropoffStop;
    if (!destStop) return;

    const now = Date.now();
    const lastFetchedAt = lastEtaFetchAtRef.current[target];
    if (lastFetchedAt !== null && now - lastFetchedAt < ETA_FETCH_THROTTLE_MS)
      return;
    lastEtaFetchAtRef.current[target] = now;

    let cancelled = false;
    geoApi
      .getRouteDirections(
        { lat: driverPosition.lat, lng: driverPosition.lng },
        { lat: destStop.lat, lng: destStop.lng },
      )
      .then((directions) => {
        if (!cancelled) {
          setEtaMinutes(directions.durationMinutes);
          setDriverDistanceKm(directions.distanceKm);
        }
      })
      .catch(() => {
        // Nice-to-have overlay only — leave the last-known etaMinutes/
        // driverDistanceKm (or null) in place rather than surfacing an error here.
      });

    return () => {
      cancelled = true;
    };
  }, [
    tripLive,
    driverPosition,
    inquiry?.pickupConfirmedAt,
    inquiry?.droppedOffAt,
    inquiry?.pickupStop,
    inquiry?.dropoffStop,
  ]);

  // Locks the rider into this screen while the trip is live: the hardware
  // back button is swallowed instead of navigating away, released again the
  // instant the trip is no longer live or this screen unmounts.
  useEffect(() => {
    if (!tripLive) return;
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => true,
    );
    return () => subscription.remove();
  }, [tripLive]);

  if (isLoading) return <LoadingState label="Loading request..." />;
  if (isError || !inquiry)
    return (
      <ErrorState message="Couldn't load this request." onRetry={refetch} />
    );

  const availableActions = tripInquiryRiderActions(inquiry.status);

  const handleCancel = async () => {
    setActionError(null);
    try {
      await updateStatus.mutateAsync({
        id: id as string,
        data: { newStatus: TripInquiryStatus.CANCELLED },
      });
    } catch (error) {
      setActionError(normalizeApiError(error).message);
    }
  };

  const pickupStop = inquiry.pickupStop;
  const dropoffStop = inquiry.dropoffStop;

  // Whole-route stops (see tripStopsQuery above), in visit order — used only
  // for the map's de-emphasized "other stops" pins and the Stops tab's
  // overview list below. Empty whenever the fetch hasn't resolved (loading,
  // disabled, or failed) — every use site below tolerates that gracefully.
  const tripStopsSorted = (tripStopsQuery.data?.stops ?? [])
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const numberedTripStops = tripStopsSorted.map((stop, index) => ({
    stop,
    sequence: index + 1,
  }));
  const dropoffRealSequence = dropoffStop
    ? numberedTripStops.find(({ stop }) => stop.id === dropoffStop.id)?.sequence
    : undefined;
  const dropoffSequence = Math.max(2, dropoffRealSequence ?? 2);

  // Every OTHER stop on the whole trip (not this rider's own pickup/dropoff) —
  // rendered as small, muted, unlabeled pins so the full route shape is
  // visible on the map without competing with the rider's own two stops.
  // Never a fixed/fabricated count — however many real intermediate stops
  // the fetch returns.
  const otherTripStops: LiveTripStop[] = numberedTripStops
    .filter(
      ({ stop }) =>
        stop.id !== pickupStop?.id &&
        stop.id !== dropoffStop?.id &&
        stop.lat != null &&
        stop.lng != null,
    )
    .map(({ stop, sequence }) => ({
      id: stop.id,
      type: stop.type,
      label: stop.label,
      lat: stop.lat as number,
      lng: stop.lng as number,
      sequence,
      status: 'upcoming' as const,
    }));

  // pickupStop/dropoffStop carry no `type` field of their own (unlike
  // ManifestRouteStop on the driver side), so it's added here to satisfy
  // LiveTripMap's LiveTripStop shape. Pickup is always sequence 1 and swaps
  // 'selected' → 'reached' once the rider has locally confirmed being at the
  // stop (see riderConfirmedAtPickup above) — matching the reference
  // mockup's pin logic exactly. Dropoff always renders 'upcoming'.
  const mapStops: LiveTripStop[] = [
    pickupStop
      ? {
          id: pickupStop.id,
          type: 'PICKUP' as const,
          label: pickupStop.label,
          lat: pickupStop.lat,
          lng: pickupStop.lng,
          sequence: 1,
          status: riderConfirmedAtPickup
            ? ('reached' as const)
            : ('selected' as const),
        }
      : null,
    dropoffStop
      ? {
          id: dropoffStop.id,
          type: 'DROPOFF' as const,
          label: dropoffStop.label,
          lat: dropoffStop.lat,
          lng: dropoffStop.lng,
          sequence: dropoffSequence,
          status: 'upcoming' as const,
        }
      : null,
    ...otherTripStops,
  ].filter((stop): stop is LiveTripStop => stop !== null);

  const pickupDistanceM =
    position && pickupStop
      ? haversineDistanceMeters(
          position.coords.latitude,
          position.coords.longitude,
          pickupStop.lat,
          pickupStop.lng,
        )
      : null;
  const dropoffDistanceM =
    position && dropoffStop
      ? haversineDistanceMeters(
          position.coords.latitude,
          position.coords.longitude,
          dropoffStop.lat,
          dropoffStop.lng,
        )
      : null;

  const showArriveButton =
    !inquiry.pickupConfirmedAt &&
    inquiry.trip.status === TripStatus.IN_PROGRESS &&
    pickupStop !== null;
  const canArrive =
    pickupDistanceM !== null && pickupDistanceM <= GEOFENCE_RADIUS_M;
  const arriveDisabledReason = locationDenied
    ? 'Enable location access to confirm your arrival.'
    : !position
      ? 'Waiting for your location…'
      : 'Move within 100m of your pickup point to confirm arrival.';

  const showCompleteButton =
    !inquiry.droppedOffAt &&
    (inquiry.trip.status === TripStatus.IN_PROGRESS ||
      inquiry.trip.status === TripStatus.COMPLETED);
  const canComplete =
    !dropoffStop ||
    (dropoffDistanceM !== null && dropoffDistanceM <= GEOFENCE_RADIUS_M);
  const completeDisabledReason = locationDenied
    ? 'Enable location access to complete the ride.'
    : !position
      ? 'Waiting for your location…'
      : 'Move within 100m of your drop-off point to complete the ride.';

  // Which stop the live ETA above is currently aimed at — mirrors the same
  // pickupConfirmedAt gate the ETA-fetch effect itself uses.
  const etaTarget: 'pickup' | 'dropoff' = inquiry.pickupConfirmedAt
    ? 'dropoff'
    : 'pickup';
  const showEta = etaMinutes !== null && !inquiry.droppedOffAt;

  // Whether the pickup reads as "reached" for DISPLAY purposes (badge, note,
  // seq-dot color) — either the rider's own local self-report or the real,
  // driver-authoritative field, whichever comes first. The action button
  // below still gates strictly on the real showArriveButton/canArrive logic,
  // never on this.
  const pickupReached = riderConfirmedAtPickup || !!inquiry.pickupConfirmedAt;

  const handleRiderEvent = async (
    type: typeof TripEventType.ARRIVED | typeof TripEventType.DROPOFF,
  ) => {
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
      // Local-only self-report flag (see riderConfirmedAtPickup's own doc
      // comment above) — set on a successful ARRIVED event, never touching
      // the real inquiry.pickupConfirmedAt field itself.
      if (type === TripEventType.ARRIVED) setRiderConfirmedAtPickup(true);
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
        // Mirrors the success path above — an offline-queued ARRIVED still
        // reflects the rider's self-report locally, same as the driver
        // screen's own optimistic-on-queue handling of its analogous events.
        if (type === TripEventType.ARRIVED) setRiderConfirmedAtPickup(true);
      } else {
        setActionError(normalized.message);
      }
    } finally {
      setActioningType(null);
    }
  };

  // Hands off to the device's external navigation app for the given stop —
  // identical Linking pattern to the driver screen's own handleNavigate
  // (my-trips/[id].tsx), reused here for consistency.
  const handleNavigateToStop = (stop: { lat: number; lng: number }) => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}&travelmode=driving`;
    Linking.openURL(url).catch(() => {});
  };

  if (!tripLive) {
    // Non-live states (not yet accepted, rejected, pending, or accepted but
    // the trip hasn't started yet) — unchanged from before this redesign,
    // aside from removing the old chat-modal button (chat now only ever
    // lives in the tripLive layout's Chat modal below).
    return (
      <AppScreen edges={['left', 'right', 'bottom']}>
        <Stack.Screen options={{ title: 'Trip request' }} />
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
            }}
          >
            <AppText
              variant="title"
              style={{
                flex: 1,
                marginRight: spacing.md,
                textTransform: 'capitalize',
              }}
            >
              {titleCase(inquiry.trip.originCity)} →{' '}
              {titleCase(inquiry.trip.destinationCity)}
            </AppText>
            <StatusBadge
              label={tripInquiryStatusMeta[inquiry.status].label}
              tone={tripInquiryStatusMeta[inquiry.status].tone}
            />
          </View>
          <AppText muted style={{ marginTop: spacing.xs }}>
            {inquiry.trip.postedBy.name}
          </AppText>

          <AppCard style={{ marginTop: spacing.lg }}>
            <Row
              label="Departure"
              value={new Date(inquiry.trip.departureAt).toLocaleString(
                undefined,
                { dateStyle: 'full', timeStyle: 'short' },
              )}
            />
            <Row
              label="Seats requested"
              value={String(inquiry.requestedSeats)}
            />
            <Row label="Pickup point" value={inquiry.trip.pickupPoint} />
            {inquiry.pickupNote ? (
              <Row label="Your note" value={inquiry.pickupNote} />
            ) : null}
            <Row
              label="Price / seat"
              value={formatPrice(inquiry.trip.pricePerSeat)}
            />
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
            <AppCard
              style={{ marginTop: spacing.lg, borderColor: colors.success }}
            >
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
            </AppCard>
          ) : null}

          {inquiry.status === 'ACCEPTED' &&
          inquiry.trip.status !== TripStatus.ACTIVE ? (
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
                  You&apos;re on the trip — picked up at{' '}
                  {formatTime(inquiry.pickupConfirmedAt)}.
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

          {showArriveButton || showCompleteButton ? (
            <AppCard style={{ marginTop: spacing.lg }}>
              <AppText variant="label" style={{ marginBottom: spacing.sm }}>
                Ride actions
              </AppText>

              {showArriveButton ? (
                <View
                  style={{ marginBottom: showCompleteButton ? spacing.md : 0 }}
                >
                  <AppButton
                    title="I've arrived"
                    loading={actioningType === TripEventType.ARRIVED}
                    disabled={!canArrive || actioningType !== null}
                    onPress={() => handleRiderEvent(TripEventType.ARRIVED)}
                  />
                  {!canArrive ? (
                    <AppText
                      muted
                      variant="caption"
                      style={{ marginTop: spacing.xs }}
                    >
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
                    <AppText
                      muted
                      variant="caption"
                      style={{ marginTop: spacing.xs }}
                    >
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
              title={
                inquiry.status === 'ACCEPTED'
                  ? 'Cancel my seat'
                  : 'Cancel request'
              }
              variant="danger"
              loading={updateStatus.isPending}
              onPress={handleCancel}
              style={{ marginTop: spacing.xl }}
            />
          ) : null}
        </ScrollView>
      </AppScreen>
    );
  }

  // --- tripLive layout: ride header + map/overlay on top, a tap-only tab bar
  // (Stops / Driver / Summary) below it, a flex:1 area rendering whichever
  // tab is selected, then a pinned action bar. Chat is a modal (ChatModalSheet)
  // opened from the Driver tab, mirroring the driver's own parallel
  // my-trips/[id].tsx redesign (Stops/Riders/Details + modal chat).
  const driverName = inquiry.trip.postedBy.name;
  const driverPhone = inquiry.trip.postedBy.phone;
  const driverInitials =
    driverName
      .trim()
      .split(/\s+/)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('')
      .slice(0, 2) || '?';

  const vehicleName = `${titleCase(inquiry.trip.userVehicle.make)} ${titleCase(inquiry.trip.userVehicle.model)}`;
  const vehiclePlate = inquiry.trip.userVehicle.plateNumber;
  // Colour/year aren't on the (lighter) TripInquiryTrip.userVehicle shape —
  // only on the fuller TripDetail from tripStopsQuery above, once it's
  // loaded. Shown only when actually present; never fabricated.
  const vehicleColor = tripStopsQuery.data?.userVehicle.color ?? null;
  const vehicleYear = tripStopsQuery.data?.userVehicle.year ?? null;

  const pickupDistanceLabel =
    pickupDistanceM !== null
      ? `${formatDistanceShort(pickupDistanceM / 1000)} from you`
      : null;
  const driverDistanceLabel =
    driverDistanceKm !== null ? formatDistanceShort(driverDistanceKm) : null;

  // Map overlay banner (mockup section: map's bottom-anchored card) — two
  // distinct states gated on the LOCAL riderConfirmedAtPickup flag, per the
  // mockup's own atPickup toggle. The post-confirmation state's eta/distance
  // numbers are the existing, real, throttled state (showEta/etaMinutes/
  // driverDistanceKm) — never a fabricated always-on value.
  const bannerCaption = riderConfirmedAtPickup
    ? driverDistanceLabel
      ? `Driver arriving · ${driverDistanceLabel}`
      : 'Driver arriving'
    : pickupDistanceLabel
      ? `Your pickup · ${pickupDistanceLabel}`
      : 'Your pickup';
  const bannerTitle = riderConfirmedAtPickup
    ? showEta
      ? `${driverName} is ${formatEtaLabel(etaMinutes as number)} away`
      : `${driverName} is on the way`
    : (pickupStop?.label ?? 'Pickup point');
  const bannerActionTitle = riderConfirmedAtPickup ? 'Track' : 'Navigate';
  const handleBannerAction = () => {
    if (riderConfirmedAtPickup) return; // "Track": no imperative recenter API is exposed by LiveTripMap (out of
    // scope to add in this stage) and the map already re-fits to `stops` on
    // every change, so this is intentionally a no-op — see WHAT TO BUILD §2.
    if (pickupStop) handleNavigateToStop(pickupStop);
  };

  const progressTitle = inquiry.droppedOffAt
    ? 'Ride completed'
    : showEta
      ? etaTarget === 'pickup'
        ? `Pickup in ${formatEtaLabel(etaMinutes as number)}`
        : `Dropoff in ${formatEtaLabel(etaMinutes as number)}`
      : riderConfirmedAtPickup
        ? 'Waiting for driver'
        : 'Head to your pickup point';
  const progressMeta = dropoffStop
    ? `Arriving ${dropoffStop.label}`
    : `Arriving ${titleCase(inquiry.trip.destinationCity)}`;

  const pricePerSeatNum =
    typeof inquiry.trip.pricePerSeat === 'string'
      ? parseFloat(inquiry.trip.pricePerSeat)
      : (inquiry.trip.pricePerSeat as number);
  const fareEstimate = Number.isFinite(pricePerSeatNum)
    ? pricePerSeatNum * inquiry.requestedSeats
    : 0;

  return (
    <AppScreen edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: 'Trip request' }} />

      <View style={{ flex: 1 }}>
        {/* Ride header */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: spacing.md,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.sm,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText muted variant="caption">
              Your ride · today
            </AppText>
            <AppText
              variant="title"
              numberOfLines={1}
              style={{ textTransform: 'capitalize' }}
            >
              {titleCase(inquiry.trip.originCity)} →{' '}
              {titleCase(inquiry.trip.destinationCity)}
            </AppText>
          </View>
          <StatusBadge
            label={
              riderConfirmedAtPickup ? 'Driver On The Way' : 'Head To Pickup'
            }
            tone={riderConfirmedAtPickup ? 'success' : 'warning'}
          />
        </View>

        {/* Map section: pinned, plus its bottom-anchored overlay banner. */}
        <View
          style={{
            height: 340,
            marginHorizontal: spacing.lg,
            marginTop: spacing.lg,
            borderRadius: radii.card,
            overflow: 'hidden',
          }}
        >
          <LiveTripMap
            stops={mapStops}
            driverPosition={driverPosition}
            isConnected={isConnected}
            lastUpdateAt={driverLastUpdateAt}
            routePolyline={routePolyline}
            driverLabel="D"
          />

          {pickupStop ? (
            <AppCard
              style={{
                position: 'absolute',
                left: spacing.md,
                right: spacing.md,
                bottom: spacing.md,
                ...shadows.md,
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.md,
                }}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <AppText muted variant="caption" numberOfLines={1}>
                    {bannerCaption}
                  </AppText>
                  <AppText variant="subtitle" numberOfLines={1}>
                    {bannerTitle}
                  </AppText>
                </View>
                <AppButton
                  title={bannerActionTitle}
                  variant="secondary"
                  fullWidth={false}
                  onPress={handleBannerAction}
                />
              </View>
            </AppCard>
          ) : null}
        </View>

        {/* Tabs */}
        <View
          style={{
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.lg,
            paddingBottom: spacing.md,
          }}
        >
          <TabBar
            tabs={TRIP_LIVE_TABS}
            activeKey={activeTab}
            onChange={(key) => setActiveTab(key as TripLiveTabKey)}
          />
        </View>

        <View style={{ flex: 1 }}>
          {/* Stops tab */}
          <View
            style={{
              flex: 1,
              display: activeTab === 'stops' ? 'flex' : 'none',
            }}
          >
            <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
              <View style={{ gap: spacing.md }}>
                {riderConfirmedAtPickup ? (
                  <AppCard style={{ borderColor: colors.primary }}>
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: spacing.md,
                      }}
                    >
                      <AppText variant="label">Driver on the way</AppText>
                      <StatusBadge label="Live" tone="success" />
                    </View>
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'baseline',
                        gap: spacing.sm,
                        marginTop: spacing.sm,
                      }}
                    >
                      <AppText variant="title" color={colors.primary}>
                        {showEta
                          ? formatEtaLabel(etaMinutes as number)
                          : 'Calculating…'}
                      </AppText>
                      {driverDistanceLabel ? (
                        <AppText muted variant="caption">
                          {driverDistanceLabel} away
                        </AppText>
                      ) : null}
                    </View>
                    <AppText
                      muted
                      variant="caption"
                      style={{ marginTop: spacing.sm }}
                    >
                      Updated just now · {vehicleName}, {vehiclePlate}.
                    </AppText>
                  </AppCard>
                ) : null}

                {pickupStop ? (
                  <AppCard
                    style={{
                      borderColor: pickupReached
                        ? colors.border
                        : colors.primary,
                    }}
                  >
                    <View
                      style={{
                        flexDirection: 'row',
                        gap: spacing.md,
                        alignItems: 'flex-start',
                      }}
                    >
                      <View
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 14,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: pickupReached
                            ? REACHED_DOT_BG
                            : colors.primary,
                        }}
                      >
                        <AppText
                          variant="label"
                          color={
                            pickupReached ? REACHED_DOT_FG : colors.primaryText
                          }
                        >
                          1
                        </AppText>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: spacing.xs,
                          }}
                        >
                          <AppText variant="label" color={colors.primary}>
                            Your pickup
                          </AppText>
                          {pickupDistanceLabel ? (
                            <AppText muted variant="caption">
                              {pickupDistanceLabel}
                            </AppText>
                          ) : null}
                        </View>
                        <AppText variant="subtitle" numberOfLines={1}>
                          {pickupStop.label}
                        </AppText>
                        <AppText muted variant="caption">
                          {pickupReached
                            ? 'You confirmed you are here.'
                            : 'Be at the stop before the driver arrives.'}
                        </AppText>
                      </View>
                      <StatusBadge
                        label={pickupReached ? 'Waiting Here' : 'Not There Yet'}
                        tone={pickupReached ? 'success' : 'warning'}
                      />
                    </View>
                    <View
                      style={{
                        flexDirection: 'row',
                        gap: spacing.sm,
                        marginTop: spacing.md,
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <AppButton
                          title={
                            pickupReached
                              ? "I'm at the stop"
                              : 'I reached the stop'
                          }
                          variant={pickupReached ? 'outline' : 'primary'}
                          loading={actioningType === TripEventType.ARRIVED}
                          disabled={
                            pickupReached ||
                            !showArriveButton ||
                            !canArrive ||
                            actioningType !== null
                          }
                          onPress={() =>
                            handleRiderEvent(TripEventType.ARRIVED)
                          }
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <AppButton
                          title="Navigate there"
                          variant="ghost"
                          onPress={() => handleNavigateToStop(pickupStop)}
                        />
                      </View>
                    </View>
                    {!pickupReached && showArriveButton && !canArrive ? (
                      <AppText
                        muted
                        variant="caption"
                        style={{ marginTop: spacing.xs }}
                      >
                        {arriveDisabledReason}
                      </AppText>
                    ) : null}
                  </AppCard>
                ) : null}

                {dropoffStop ? (
                  <AppCard>
                    <View
                      style={{
                        flexDirection: 'row',
                        gap: spacing.md,
                        alignItems: 'flex-start',
                      }}
                    >
                      <View
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 14,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: inquiry.droppedOffAt
                            ? REACHED_DOT_BG
                            : UPCOMING_DOT_BG,
                        }}
                      >
                        <AppText
                          variant="label"
                          color={
                            inquiry.droppedOffAt
                              ? REACHED_DOT_FG
                              : colors.textMuted
                          }
                        >
                          {dropoffSequence}
                        </AppText>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: spacing.xs,
                          }}
                        >
                          <AppText variant="label">Your dropoff</AppText>
                          {dropoffDistanceM !== null ? (
                            <AppText muted variant="caption">
                              {formatDistanceShort(dropoffDistanceM / 1000)}
                            </AppText>
                          ) : null}
                        </View>
                        <AppText variant="subtitle" numberOfLines={1}>
                          {dropoffStop.label}
                        </AppText>
                        <AppText muted variant="caption">
                          {inquiry.droppedOffAt
                            ? 'You completed this ride.'
                            : 'Complete your ride once you arrive.'}
                        </AppText>
                      </View>
                      <StatusBadge
                        label={inquiry.droppedOffAt ? 'Completed' : 'Upcoming'}
                        tone={inquiry.droppedOffAt ? 'complete' : 'neutral'}
                      />
                    </View>
                    <View
                      style={{
                        flexDirection: 'row',
                        gap: spacing.sm,
                        marginTop: spacing.md,
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <AppButton
                          title={inquiry.droppedOffAt ? 'Completed' : 'Reached'}
                          variant={inquiry.droppedOffAt ? 'outline' : 'primary'}
                          loading={actioningType === TripEventType.DROPOFF}
                          disabled={
                            !!inquiry.droppedOffAt ||
                            !showCompleteButton ||
                            !canComplete ||
                            actioningType !== null
                          }
                          onPress={() =>
                            handleRiderEvent(TripEventType.DROPOFF)
                          }
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <AppButton
                          title="Navigate there"
                          variant="ghost"
                          onPress={() => handleNavigateToStop(dropoffStop)}
                        />
                      </View>
                    </View>
                    {!inquiry.droppedOffAt &&
                    showCompleteButton &&
                    !canComplete ? (
                      <AppText
                        muted
                        variant="caption"
                        style={{ marginTop: spacing.xs }}
                      >
                        {completeDisabledReason}
                      </AppText>
                    ) : null}
                  </AppCard>
                ) : null}

                <AppCard>
                  <AppText variant="label" style={{ marginBottom: spacing.md }}>
                    Stops on this ride
                  </AppText>
                  {tripStopsQuery.isLoading ? (
                    <AppText muted variant="caption">
                      Loading…
                    </AppText>
                  ) : tripStopsSorted.length === 0 ? (
                    <AppText muted variant="caption">
                      Route details aren&apos;t available right now.
                    </AppText>
                  ) : (
                    <View style={{ gap: spacing.sm }}>
                      {tripStopsSorted.map((stop) => {
                        const mine =
                          stop.id === pickupStop?.id ||
                          stop.id === dropoffStop?.id;
                        return (
                          <View
                            key={stop.id}
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: spacing.sm,
                            }}
                          >
                            <View
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: 4,
                                backgroundColor: mine
                                  ? colors.primary
                                  : colors.borderStrong,
                              }}
                            />
                            <AppText
                              variant="body"
                              color={mine ? colors.text : colors.textMuted}
                              numberOfLines={1}
                              style={{ flex: 1, minWidth: 0 }}
                            >
                              {stop.label}
                            </AppText>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </AppCard>

                {actionError ? (
                  <AppText color={colors.danger}>{actionError}</AppText>
                ) : null}
              </View>
            </ScrollView>
          </View>

          {/* Driver tab */}
          <View
            style={{
              flex: 1,
              display: activeTab === 'driver' ? 'flex' : 'none',
            }}
          >
            <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
              <View style={{ gap: spacing.md }}>
                <AppCard>
                  <View
                    style={{
                      flexDirection: 'row',
                      gap: spacing.md,
                      alignItems: 'flex-start',
                    }}
                  >
                    <View
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 24,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: AVATAR_BG,
                      }}
                    >
                      <AppText variant="label" color={AVATAR_FG}>
                        {driverInitials}
                      </AppText>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <AppText variant="subtitle" numberOfLines={1}>
                        {driverName}
                      </AppText>
                    </View>
                    <StatusBadge
                      label={riderConfirmedAtPickup ? 'On The Way' : 'En Route'}
                      tone="accent"
                    />
                  </View>
                  <View
                    style={{
                      flexDirection: 'row',
                      gap: spacing.sm,
                      marginTop: spacing.md,
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <AppButton
                        title="Chat"
                        onPress={() => setChatOpen(true)}
                      />
                    </View>
                    {driverPhone ? (
                      <View style={{ flex: 1 }}>
                        <AppButton
                          title="Call"
                          variant="outline"
                          onPress={() =>
                            Linking.openURL(`tel:${driverPhone}`).catch(
                              () => {},
                            )
                          }
                        />
                      </View>
                    ) : null}
                  </View>
                </AppCard>

                <AppCard>
                  <AppText variant="label" style={{ marginBottom: spacing.md }}>
                    Vehicle
                  </AppText>
                  <View style={{ gap: spacing.md }}>
                    <DetailRow
                      label="Vehicle"
                      value={
                        vehicleYear
                          ? `${vehicleYear} ${vehicleName}`
                          : vehicleName
                      }
                    />
                    {vehicleColor ? (
                      <DetailRow label="Colour" value={vehicleColor} />
                    ) : null}
                    <DetailRow label="Plate" value={vehiclePlate} />
                  </View>
                </AppCard>
              </View>
            </ScrollView>
          </View>

          {/* Summary tab */}
          <View
            style={{
              flex: 1,
              display: activeTab === 'summary' ? 'flex' : 'none',
            }}
          >
            <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
              <View style={{ gap: spacing.md }}>
                <AppCard>
                  <AppText variant="label" style={{ marginBottom: spacing.md }}>
                    Ride summary
                  </AppText>
                  <View style={{ gap: spacing.md }}>
                    <DetailRow
                      label="Route"
                      value={`${titleCase(inquiry.trip.originCity)} → ${titleCase(inquiry.trip.destinationCity)}`}
                    />
                    <DetailRow
                      label="Your seat"
                      value={`${inquiry.requestedSeats} seat${inquiry.requestedSeats !== 1 ? 's' : ''}`}
                    />
                    <DetailRow
                      label="Pickup"
                      value={pickupStop?.label ?? '—'}
                    />
                    <DetailRow
                      label="Dropoff"
                      value={dropoffStop?.label ?? '—'}
                    />
                    <DetailRow
                      label="Booked"
                      value={formatDate(inquiry.createdAt)}
                    />
                  </View>
                </AppCard>

                <AppCard>
                  <AppText variant="label" style={{ marginBottom: spacing.md }}>
                    Fare
                  </AppText>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'baseline',
                      gap: spacing.sm,
                    }}
                  >
                    <AppText variant="title" color={colors.primary}>
                      {formatPrice(fareEstimate)}
                    </AppText>
                    <AppText muted variant="caption">
                      / {inquiry.requestedSeats} seat
                      {inquiry.requestedSeats !== 1 ? 's' : ''}
                    </AppText>
                  </View>
                  <AppText
                    muted
                    variant="caption"
                    style={{ marginTop: spacing.sm }}
                  >
                    Estimate only — paid to the driver directly.
                  </AppText>
                </AppCard>
              </View>
            </ScrollView>
          </View>
        </View>

        {/* Action bar (pinned): progress on the left, the real cancel-seat
            action on the right — unchanged availableActions/handleCancel gating. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: spacing.md,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.md,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            backgroundColor: colors.background,
          }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText variant="label" numberOfLines={1}>
              {progressTitle}
            </AppText>
            <AppText muted variant="caption" numberOfLines={1}>
              {progressMeta}
            </AppText>
          </View>
          {availableActions.includes(TripInquiryStatus.CANCELLED) ? (
            <AppButton
              title="Cancel seat"
              variant="danger"
              fullWidth={false}
              loading={updateStatus.isPending}
              onPress={handleCancel}
            />
          ) : null}
        </View>
      </View>

      {/* Chat (mockup section: Chat sheet) — modal, opened from the Driver
          tab's Chat button, reusing the exact same ChatModalSheet component
          the driver screen's own rebuild uses (wrapping ChatPanel,
          untouched). ChatModalSheet's props are named for a per-rider
          pickup/dropoff subtitle on the driver's screen; reused here for a
          vehicle-name/plate subtitle instead — no internals changed. */}
      <ChatModalSheet
        visible={chatOpen}
        onClose={() => setChatOpen(false)}
        tripInquiryId={inquiry.id}
        riderName={driverName}
        pickupLabel={vehicleName}
        dropoffLabel={vehiclePlate}
      />
    </AppScreen>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const { colors, spacing } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: spacing.md,
      }}
    >
      <AppText muted variant="body">
        {label}
      </AppText>
      <AppText
        variant="body"
        color={colors.text}
        style={{ textAlign: 'right', flexShrink: 1 }}
      >
        {value}
      </AppText>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const { spacing } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: spacing.xs,
      }}
    >
      <AppText muted variant="caption">
        {label}
      </AppText>
      <AppText variant="caption">{value}</AppText>
    </View>
  );
}
