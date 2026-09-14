import { useEffect, useRef, useState } from 'react';
import { BackHandler, Linking, Modal, Pressable, ScrollView, View } from 'react-native';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';

import {
  useCancelTrip,
  useEndTrip,
  useMyTrip,
  useRecordTripEvent,
  useStartTrip,
  useTripManifest,
} from '../../../features/trips/queries';
import { useOfflineTripQueue } from '../../../features/trips/offlineSync';
import { useRideSocket } from '../../../features/liveRide/socket';
import { LiveTripMap, type LiveTripStop } from '../../../features/liveRide/components/LiveTripMap';
import { ChatModalSheet } from '../../../features/liveRide/components/ChatModalSheet';
import { geoApi, type RouteDirections } from '../../../api/geo.api';
import type { ManifestRider, ManifestRouteStop, RecordTripEventPayload } from '../../../api/trips.api';
import { useTripInquiryInbox, useUpdateTripInquiryStatus } from '../../../features/trip-inquiries/queries';
import { useAuth } from '../../../auth/auth-context';
import {
  AppButton,
  AppCard,
  AppInput,
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
  tripPosterActions,
  tripStatusMeta,
  tripInquiryStatusMeta,
  PickupSource,
  TripEventType,
  TripInquiryStatus,
  TripStatus,
} from '../../../types/enums';
import { formatDate, formatDistance, formatPrice, titleCase } from '../../../utils/format';
import { normalizeApiError } from '../../../api/errors';

// Driver must be within this many meters of a stop to confirm arrival there.
const ARRIVAL_RADIUS_METERS = 100;

// Mirrors the backend's common/utils/geo.util.ts haversineDistanceKm formula
// exactly (meters instead of km) — duplicated here since this is a separate app.
const EARTH_RADIUS_METERS = 6371000;
function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

// Design-spec literal colors (active-ride-driver-spec.md §4.1/§4.2) that have
// no matching theme token — same convention LiveTripMap.tsx uses for its own
// "reached" pin colors.
const REACHED_DOT_BG = '#FFDDE2';
const REACHED_DOT_FG = '#C2203C';
const UPCOMING_DOT_BG = '#FFF0F2';
const AVATAR_BG = '#FFF0F2';
const AVATAR_FG = '#C2203C';

interface WatchedPosition {
  lat: number;
  lng: number;
  accuracy: number | null;
  mocked?: boolean;
}

type DriverTab = 'stops' | 'riders' | 'details';

// Module-level constant — stable identity across renders, no need to
// recreate this array on every render just to pass it to TabBar.
const DRIVER_TABS: TabBarItem[] = [
  { key: 'stops', label: 'Stops' },
  { key: 'riders', label: 'Riders' },
  { key: 'details', label: 'Details' },
];

export default function MyTripDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, spacing, radii } = useTheme();
  const { user } = useAuth();
  const { data: trip, isLoading, isError, refetch } = useMyTrip(id);
  const cancelTrip = useCancelTrip(id as string);
  const startTrip = useStartTrip(id as string);
  const endTrip = useEndTrip(id as string);
  const recordEvent = useRecordTripEvent(id as string);
  const [actionError, setActionError] = useState<string | null>(null);
  const [startConfirming, setStartConfirming] = useState(false);
  const [endConfirming, setEndConfirming] = useState(false);
  // NO_SHOW doesn't change pickupConfirmedAt/droppedOffAt server-side (it's
  // just a logged event), so there's nothing to refetch — track it locally
  // to keep the tap visible until the next manifest fetch (e.g. after End Trip).
  const [noShowIds, setNoShowIds] = useState<Set<string>>(new Set());
  // Applied when start/pickup/dropoff/end calls fail with a network error and
  // get queued instead — lets the driver keep working through the whole flow
  // offline (e.g. start the trip, then tap pickups along a low-signal route)
  // without waiting on a round trip that can't happen yet. Real data from the
  // server always wins once the queue syncs (see the merges below).
  const [optimisticStarted, setOptimisticStarted] = useState(false);
  const [optimisticEnded, setOptimisticEnded] = useState(false);
  const [optimisticEvents, setOptimisticEvents] = useState<
    Record<string, { pickupConfirmedAt?: string; droppedOffAt?: string }>
  >({});
  // ARRIVED doesn't change any rider/trip field the manifest refetch would pick
  // up (it's just a logged event, like NO_SHOW) — tracked locally so the button
  // reflects a just-recorded arrival until the next remount.
  const [arrivedStopIds, setArrivedStopIds] = useState<Set<string>>(new Set());
  const [currentPosition, setCurrentPosition] = useState<WatchedPosition | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  // Which accepted rider's chat thread is open, if any — a single slot
  // (rather than one per rider) guarantees only one ChatPanel is ever
  // mounted/joined at a time; opening a different rider's chat just replaces
  // this value. The Riders tab's per-rider "Chat" button is this state's only
  // writer (see openChat below) — chat is a modal sheet now, not a tab.
  const [chatTarget, setChatTarget] = useState<{ id: string; name: string } | null>(null);
  // Local, presentational-only unread counts for the Riders tab's "Chat · N"
  // badges — keyed by tripInquiryId. Not persisted or backfilled from history
  // on mount (every rider starts at 0 whenever this screen mounts); a thread's
  // count resets to 0 the moment it's opened (see openChat) and only
  // increments for a message that isn't from the current user and isn't for
  // the thread currently open (see the onChatMessage effect below).
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  // Which of the Stops/Riders/Details tabs is active, once the in-progress/
  // completed tabbed layout is shown below. Stops is the default per spec —
  // that's the screen a driver needs mid-trip most often.
  const [activeTab, setActiveTab] = useState<DriverTab>('stops');
  // Which stop's route is currently PREVIEWED on the map — defaults to (and
  // auto-follows) nextStop, but the driver can tap a different stop's card in
  // the Stops tab (or a pin on the map) to preview the route there instead.
  // This is a purely visual/non-destructive preview: it drives ONLY the map
  // polyline/next-stop-banner below, never handleArrived, which always stays
  // tied to nextStop itself (see the Reached button in the map overlay and in
  // each Stops-tab card below) — this separation is what keeps carpool
  // stop-order integrity intact. See the auto-track sync further down (right
  // after nextStop is computed) for exactly how/when this re-syncs to nextStop.
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  // The nextStop id selectedStopId was last auto-synced against — see the
  // render-time sync further down (right after nextStop is computed) for how
  // this drives the "auto-track nextStop by default" behavior.
  const [syncedNextStopId, setSyncedNextStopId] = useState<string | null>(null);
  // ISO timestamp of the last location-watch fix — fed to LiveTripMap so it
  // can show "last known location as of ..." once the socket disconnects.
  const [lastLocationUpdateAt, setLastLocationUpdateAt] = useState<string | null>(null);
  // Turn-by-turn overlay (polyline + distance/duration) for the current
  // PREVIEWED stop's leg (see selectedStopId above) — see the fetch effect
  // below for exactly when this is populated.
  const [routeDirections, setRouteDirections] = useState<RouteDirections | null>(null);
  // Which stop id directions have already been fetched for — guards the
  // effect below so the endpoint is called once per distinct previewed stop,
  // never on a timer or on every GPS tick.
  const fetchedRouteForStopId = useRef<string | null>(null);
  // Mirror the latest previewed stop (whichever stop selectedStopId currently
  // resolves to) and currentPosition for the fetch effect further down to
  // read without listing them as dependencies — see that effect's own
  // comment for why.
  const previewStopRef = useRef<ManifestRouteStop | null>(null);
  const currentPositionRef = useRef<WatchedPosition | null>(null);
  const { isConnected, isReady, joinTrip, leaveTrip, emitLocation, onChatMessage } = useRideSocket();

  const { data: inquiriesRes, isLoading: inquiriesLoading } = useTripInquiryInbox({
    tripId: id as string,
  });
  const updateInquiryStatus = useUpdateTripInquiryStatus();
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineNote, setDeclineNote] = useState('');

  // Fetched (and cached by react-query) regardless of status — the backend
  // doesn't gate this on trip status either — so a manifest fetched earlier
  // while online is already sitting in cache if "Start trip" is later tapped
  // offline. Only the CARD's visibility is gated on effective status below.
  const { data: manifest, isLoading: manifestLoading } = useTripManifest(id);
  const offlineQueue = useOfflineTripQueue(id);

  // Computed here (not after the loading/error guards below) so the hooks that
  // depend on it — the location watch — always run in the same order.
  const effectiveInProgress =
    !!trip && (trip.status === TripStatus.IN_PROGRESS || (trip.status === TripStatus.ACTIVE && optimisticStarted));

  // Foreground-only location watch, active only while the trip is in progress —
  // used to geofence the stop-level "Arrived" button below. Cleans itself up on
  // unmount and whenever the trip is no longer in progress.
  useEffect(() => {
    // No explicit reset here: when this becomes false, React has already run
    // the previous effect's cleanup below (which removes the subscription) —
    // there's nothing further to synchronize, so this effect run just no-ops.
    if (!effectiveInProgress) return;

    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;

    (async () => {
      const { granted } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (!granted) {
        setLocationDenied(true);
        return;
      }
      setLocationDenied(false);
      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 4000, distanceInterval: 10 },
        (location) => {
          setCurrentPosition({
            lat: location.coords.latitude,
            lng: location.coords.longitude,
            accuracy: location.coords.accuracy,
            mocked: location.mocked,
          });
          setLastLocationUpdateAt(new Date().toISOString());
          // Same fix used for the geofence check above, additionally pushed
          // over the live-ride socket for any rider/screen watching this
          // trip. This effect (and therefore the watch) only runs at all
          // while effectiveInProgress is true, so no separate check is
          // needed here.
          emitLocation({
            tripId: id as string,
            lat: location.coords.latitude,
            lng: location.coords.longitude,
            headingDeg: location.coords.heading ?? undefined,
            // expo-location reports speed in meters/second; the gateway payload is km/h.
            speedKmh: location.coords.speed != null ? location.coords.speed * 3.6 : undefined,
            accuracyM: location.coords.accuracy ?? undefined,
            isMockLocation: location.mocked ?? undefined,
            ts: Date.now(),
          });
        },
      );
      if (cancelled) subscription?.remove();
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
    // emitLocation is intentionally omitted: useRideSocket() returns a new
    // function identity every render (it reads live module state, not a
    // stale closure), so including it here would tear down and recreate the
    // location watch on every render instead of only when the trip's
    // in-progress state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveInProgress, id]);

  // Joins the socket room for this trip once the shared socket is ready
  // (which may not be the case yet on first mount), and leaves it again as
  // soon as the trip stops being in-progress or this screen unmounts.
  useEffect(() => {
    if (!effectiveInProgress || !isReady) return;

    let cancelled = false;
    joinTrip(id as string).then((result) => {
      if (!cancelled && !result.ok) {
        console.warn('[LiveRide] driver joinTrip failed:', result.error);
      }
    });

    return () => {
      cancelled = true;
      leaveTrip(id as string);
    };
    // joinTrip/leaveTrip omitted deliberately — see the note on the location
    // watch effect above, same reasoning applies here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveInProgress, isReady, id]);

  // Locks the driver into this screen while the trip is running: the
  // hardware back button is swallowed (returning true = "handled") instead
  // of navigating away, and released again the instant the trip is no
  // longer in progress or this screen unmounts.
  useEffect(() => {
    if (!effectiveInProgress) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, [effectiveInProgress]);

  // Increments a rider's unread chat count whenever a chat.message arrives for
  // their thread while it is NOT the thread currently open in the chat modal —
  // opening a thread (see openChat further down) resets that rider's count
  // back to 0 immediately, so this only ever accumulates for threads the
  // driver isn't currently looking at. Runs for the lifetime of this screen
  // (not gated on trip status) — simple, presentational tracking only, per
  // the design spec's "opening a thread clears its unread count".
  useEffect(() => {
    const unsubscribe = onChatMessage((message) => {
      if (message.senderId === user?.id) return;
      if (chatTarget && message.tripInquiryId === chatTarget.id) return;
      setUnreadCounts((prev) => ({
        ...prev,
        [message.tripInquiryId]: (prev[message.tripInquiryId] ?? 0) + 1,
      }));
    });
    return unsubscribe;
    // onChatMessage omitted deliberately — same reasoning as every other
    // useRideSocket() consumer in this file (see the location-watch effect's
    // comment above): it returns a new function identity every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatTarget, user?.id]);

  // Riders grouped/ordered by manifest.routeStops (pickup stops first, then
  // dropoff stops, per the backend's visit order) with optimistic pickup/dropoff
  // overrides merged in. A rider whose pickupStop/dropoffStop is null (legacy
  // data) — or who otherwise doesn't match any current stop — falls through to
  // "otherRiders" instead of disappearing.
  // Computed here (before the loading/error guards below), same reasoning as
  // effectiveInProgress above: the route-directions effect further down
  // depends on nextStop, so nextStop must be derived unconditionally, in the
  // same hook order on every render.
  const mergedRiders: ManifestRider[] = (manifest?.riders ?? []).map((rider) => {
    const optimistic = optimisticEvents[rider.id];
    return optimistic
      ? {
          ...rider,
          pickupConfirmedAt: rider.pickupConfirmedAt ?? optimistic.pickupConfirmedAt ?? null,
          droppedOffAt: rider.droppedOffAt ?? optimistic.droppedOffAt ?? null,
          pickupSource: rider.pickupSource ?? (optimistic.pickupConfirmedAt ? PickupSource.DRIVER_TAP : null),
        }
      : rider;
  });

  // Note: unlike the previous build, there's no separate "otherRiders" bucket
  // here — the Stops tab is a flat per-stop list (spec §4.1) and no longer
  // needs one, and the Riders tab already shows every rider in mergedRiders
  // (matched to a stop or not) directly.
  const stopGroups = (manifest?.routeStops ?? []).map((stop) => {
    const stopRiders = mergedRiders.filter((rider) =>
      stop.type === 'PICKUP' ? rider.pickupStop?.id === stop.id : rider.dropoffStop?.id === stop.id,
    );
    return { stop, riders: stopRiders };
  });

  // First stop (in visit order) that still has unfinished business: a PICKUP
  // stop with a rider not yet picked up, or a DROPOFF stop with a rider not yet
  // dropped off. NO_SHOW riders are logged but never clear pickupConfirmedAt,
  // so a no-show at a stop keeps that stop "next" — matches the driver having
  // to actually resolve everyone there before moving on.
  const nextStop: ManifestRouteStop | null =
    stopGroups.find(({ stop, riders }) =>
      stop.type === 'PICKUP' ? riders.some((r) => !r.pickupConfirmedAt) : riders.some((r) => !r.droppedOffAt),
    )?.stop ?? null;

  const nextStopDistanceM =
    nextStop && currentPosition ? haversineMeters(currentPosition, { lat: nextStop.lat, lng: nextStop.lng }) : null;
  const canConfirmArrival = nextStopDistanceM !== null && nextStopDistanceM <= ARRIVAL_RADIUS_METERS;
  const nextStopArrived = !!nextStop && arrivedStopIds.has(nextStop.id);

  // Per-stop "is every rider at this stop fully resolved for its kind"
  // (design spec §3/§4.1's "reached" state) — a NEW derived array, additive
  // alongside nextStop above (which is intentionally left untouched). Shared
  // by the map's numbered pins and the Stops tab's sequence dot/badge below.
  const stopResolutions = stopGroups.map(({ stop, riders }) => ({
    stop,
    riders,
    resolved: stop.type === 'PICKUP' ? riders.every((r) => !!r.pickupConfirmedAt) : riders.every((r) => !!r.droppedOffAt),
  }));

  // The stop selectedStopId currently resolves to (or null before the first
  // sync below, or if it somehow names a stop no longer in this manifest).
  // stopGroups covers every routeStop unconditionally (see its map() above),
  // so this lookup doesn't miss stops that happen to have no riders on them.
  const previewStop: ManifestRouteStop | null =
    stopGroups.find((group) => group.stop.id === selectedStopId)?.stop ?? null;

  // Keeps selectedStopId auto-tracking nextStop by default. Whenever nextStop
  // changes: an unset selection snaps to it immediately; an existing
  // selection that has fallen BEHIND the new nextStop in visit order (i.e. it
  // names a stop that's now fully resolved/in the past) is treated as stale
  // and snapped forward too. A selection that is still at-or-ahead of
  // nextStop — the driver deliberately previewing a later stop — is left
  // alone; that's the override this exists to support. This only ever writes
  // selectedStopId, which the Reached button below never reads —
  // handleArrived is always called with `nextStop` directly (see the map
  // overlay and each Stops-tab card in the JSX), so nothing here can affect
  // which stop arrival gets confirmed for.
  //
  // Done as a direct render-time comparison (React's documented "adjusting
  // state when a prop changes" pattern — comparing against a stored previous
  // value and calling setState immediately, guarded so it settles in one
  // extra render) rather than inside a useEffect: a synchronous setState in
  // an effect body trips this project's react-hooks/set-state-in-effect
  // lint rule. LiveTripMap's initialDriverCoordinate uses this same
  // during-render pattern for the same reason.
  if ((nextStop?.id ?? null) !== syncedNextStopId) {
    setSyncedNextStopId(nextStop?.id ?? null);
    if (nextStop) {
      const targetId = nextStop.id;
      const stopOrder = manifest?.routeStops ?? [];
      setSelectedStopId((prev) => {
        if (!prev) return targetId;
        const prevIndex = stopOrder.findIndex((s) => s.id === prev);
        const nextIndex = stopOrder.findIndex((s) => s.id === targetId);
        return prevIndex === -1 || prevIndex < nextIndex ? targetId : prev;
      });
    }
  }

  // `previewStop`/`currentPosition` are read at fetch time via these refs
  // rather than as effect dependencies — both are new object references on
  // every render (previewStop is recomputed above, currentPosition ticks
  // every ~4s from the GPS watch), so depending on them directly would re-run
  // the fetch effect below (and re-fire its cleanup) far more often than "the
  // previewed stop actually changed", racing a still-in-flight fetch against
  // its own cancellation. Kept current via their own no-dependency-array
  // effect (runs after every render, before the fetch effect below since
  // it's declared first) rather than writing the refs directly in the render
  // body — required by this app's React Compiler lint rule (react-hooks/refs).
  useEffect(() => {
    previewStopRef.current = previewStop;
    currentPositionRef.current = currentPosition;
  });

  // Route polyline + distance/duration for the map overlay, for the leg from
  // the driver's current position to whichever stop is currently PREVIEWED
  // (selectedStopId/previewStop — defaults to, and normally tracks, nextStop,
  // but the driver can preview a different stop from the Stops tab or map).
  // Depends only on effectiveInProgress, selectedStopId (already a stable
  // primitive — no ref indirection needed for the dependency itself, only for
  // reading the resolved stop object at fetch time), and whether a GPS fix
  // exists YET (a boolean, not the position itself) — so this only re-runs
  // when the previewed stop genuinely changes, or once when the very first
  // fix arrives, never on every subsequent GPS tick. `fetchedRouteForStopId`
  // additionally guards against firing twice for the same stop id. A failed
  // call or a "no route" response just clears the overlay — this is a
  // nice-to-have, never something that blocks the Arrived/Pickup/Dropoff flow.
  useEffect(() => {
    const stop = previewStopRef.current;
    if (!effectiveInProgress || !stop) return;
    if (fetchedRouteForStopId.current === stop.id) return;
    const position = currentPositionRef.current;
    if (!position) return; // no fix yet — retried once `!!currentPosition` flips true below

    fetchedRouteForStopId.current = stop.id;
    // Clear the previous stop's directions immediately so a stale
    // distance/duration/polyline never lingers on screen while the new leg
    // is fetched.
    setRouteDirections(null);

    let cancelled = false;
    geoApi
      .getRouteDirections({ lat: position.lat, lng: position.lng }, { lat: stop.lat, lng: stop.lng })
      .then((directions) => {
        if (!cancelled) setRouteDirections(directions);
      })
      .catch(() => {
        if (!cancelled) setRouteDirections(null);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveInProgress, selectedStopId, !!currentPosition]);

  if (isLoading) return <LoadingState label="Loading trip..." />;
  if (isError || !trip) return <ErrorState message="Couldn't load this trip." onRetry={refetch} />;

  const statusMeta = tripStatusMeta[trip.status];
  const effectiveCompleted = trip.status === TripStatus.COMPLETED || (effectiveInProgress && optimisticEnded);
  const showManifest = effectiveInProgress || effectiveCompleted;
  const actions = effectiveCompleted
    ? []
    : effectiveInProgress
      ? ['end' as const]
      : tripPosterActions(trip.status);

  // --- Values computed only for the rebuilt in-progress/completed view below ---
  // Ride header (spec §2): "On Trip" reads oddly once the ride has actually
  // ended, so the header badge swaps to the trip's real completed state —
  // tripStatusMeta has no "On Trip"/accent entry (it's a display label this
  // design introduces only for the active state), so it's computed directly
  // here instead of reused from tripStatusMeta.
  const rideBadge = effectiveCompleted
    ? { label: tripStatusMeta[TripStatus.COMPLETED].label, tone: tripStatusMeta[TripStatus.COMPLETED].tone }
    : { label: 'On Trip', tone: 'accent' as const };

  // Map pins (spec §3): reached takes precedence over selected — a stop the
  // driver has previewed (selectedStopId) that turns out to already be fully
  // resolved still renders as 'reached', never 'selected'.
  const mapStops: LiveTripStop[] = stopResolutions.map(({ stop, resolved }, index) => ({
    ...stop,
    sequence: index + 1,
    status: resolved ? 'reached' : stop.id === selectedStopId ? 'selected' : 'upcoming',
  }));

  const doneStopsCount = stopResolutions.filter((r) => r.resolved).length;
  const totalStopsCount = manifest?.routeStops.length ?? 0;

  // Map's next-stop banner (spec §3): caption differs depending on whether
  // the currently previewed stop is the real next stop or one the driver
  // selected deliberately; distance/duration come from the route-directions
  // fetch above (real data for the previewed leg) when it has resolved.
  const previewIsNextStop = !!nextStop && !!previewStop && previewStop.id === nextStop.id;
  const routeDistanceEta = routeDirections
    ? `${formatDistance(routeDirections.distanceKm)} · ${Math.round(routeDirections.durationMinutes)} min`
    : null;
  const navCaption = previewStop
    ? `${previewIsNextStop ? 'Next stop' : 'Selected stop'}${routeDistanceEta ? ` · ${routeDistanceEta}` : ''}`
    : '';

  // Details tab (spec §4.3) — real, honest computations from data already on
  // the manifest/trip; distance is intentionally omitted (see WHAT TO BUILD
  // item 6): TripDetail has no real distance field to report here.
  const pickupStopsCount = (manifest?.routeStops ?? []).filter((s) => s.type === 'PICKUP').length;
  const dropoffStopsCount = (manifest?.routeStops ?? []).length - pickupStopsCount;
  const totalSeats = mergedRiders.reduce((sum, r) => sum + r.requestedSeats, 0);
  const pricePerSeatNum =
    typeof trip.pricePerSeat === 'string' ? parseFloat(trip.pricePerSeat) : (trip.pricePerSeat as number);
  const earningsEstimate = Number.isFinite(pricePerSeatNum) ? pricePerSeatNum * totalSeats : 0;
  // TripDetail carries no "actual start" timestamp (only the scheduled
  // departureAt) — the trip's scheduled departure is the closest real,
  // non-fabricated stand-in the spec's "reasonable fallback" allows for.
  const startedLabel = formatDate(trip.departureAt);

  const handleCancel = async () => {
    setActionError(null);
    try {
      await cancelTrip.mutateAsync(undefined);
    } catch (error) {
      setActionError(normalizeApiError(error).message);
    }
  };

  const handleStart = async () => {
    setActionError(null);
    try {
      await startTrip.mutateAsync();
      setStartConfirming(false);
    } catch (error) {
      const normalized = normalizeApiError(error);
      if (normalized.kind === 'network') {
        await offlineQueue.enqueue({
          id: Crypto.randomUUID(),
          kind: 'start',
          tripId: id as string,
          queuedAt: new Date().toISOString(),
        });
        setOptimisticStarted(true);
        setStartConfirming(false);
      } else {
        setActionError(normalized.message);
      }
    }
  };

  const handleEnd = async () => {
    setActionError(null);
    try {
      await endTrip.mutateAsync();
      setEndConfirming(false);
    } catch (error) {
      const normalized = normalizeApiError(error);
      if (normalized.kind === 'network') {
        await offlineQueue.enqueue({
          id: Crypto.randomUUID(),
          kind: 'end',
          tripId: id as string,
          queuedAt: new Date().toISOString(),
        });
        setOptimisticEnded(true);
        setEndConfirming(false);
      } else {
        setActionError(normalized.message);
      }
    }
  };

  const handleRiderEvent = async (tripInquiryId: string, type: TripEventType) => {
    setActionError(null);
    const eventId = Crypto.randomUUID();
    const occurredAt = new Date().toISOString();
    try {
      await recordEvent.mutateAsync({ id: eventId, tripInquiryId, type, occurredAt });
      if (type === TripEventType.NO_SHOW) {
        setNoShowIds((prev) => new Set(prev).add(tripInquiryId));
      }
    } catch (error) {
      const normalized = normalizeApiError(error);
      if (normalized.kind === 'network') {
        await offlineQueue.enqueue({
          id: eventId,
          kind: 'event',
          tripId: id as string,
          queuedAt: occurredAt,
          payload: { id: eventId, tripInquiryId, type, occurredAt },
        });
        if (type === TripEventType.NO_SHOW) {
          setNoShowIds((prev) => new Set(prev).add(tripInquiryId));
        } else {
          setOptimisticEvents((prev) => ({
            ...prev,
            [tripInquiryId]: {
              ...prev[tripInquiryId],
              ...(type === TripEventType.PICKUP ? { pickupConfirmedAt: occurredAt } : { droppedOffAt: occurredAt }),
            },
          }));
        }
      } else {
        setActionError(normalized.message);
      }
    }
  };

  const handleArrived = async (stop: ManifestRouteStop) => {
    if (!currentPosition) return;
    setActionError(null);
    const eventId = Crypto.randomUUID();
    const occurredAt = new Date().toISOString();
    const payload: RecordTripEventPayload = {
      id: eventId,
      type: TripEventType.ARRIVED,
      occurredAt,
      payload: {
        stopId: stop.id,
        lat: currentPosition.lat,
        lng: currentPosition.lng,
        accuracyM: currentPosition.accuracy ?? undefined,
        isMockLocation: currentPosition.mocked ?? undefined,
      },
    };
    try {
      await recordEvent.mutateAsync(payload);
      setArrivedStopIds((prev) => new Set(prev).add(stop.id));
    } catch (error) {
      const normalized = normalizeApiError(error);
      if (normalized.kind === 'network') {
        await offlineQueue.enqueue({
          id: eventId,
          kind: 'event',
          tripId: id as string,
          queuedAt: occurredAt,
          payload,
        });
        setArrivedStopIds((prev) => new Set(prev).add(stop.id));
      } else {
        setActionError(normalized.message);
      }
    }
  };

  // Hands off to the device's external navigation app for the CURRENTLY
  // PREVIEWED stop (spec §3's "Navigate" button) — never touches the
  // Arrived/pickup/dropoff flow, purely a deep link. Swallows any failure so
  // a missing/unsupported maps app can never crash this screen.
  const handleNavigate = (stop: ManifestRouteStop) => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}&travelmode=driving`;
    Linking.openURL(url).catch(() => {});
  };

  // Opens a rider's chat thread and immediately clears its unread count —
  // the single writer of both chatTarget and unreadCounts[riderId] for the
  // "opening a thread clears its unread count" rule (spec §5).
  const openChat = (riderId: string, riderName: string) => {
    setChatTarget({ id: riderId, name: riderName });
    setUnreadCounts((prev) => (prev[riderId] ? { ...prev, [riderId]: 0 } : prev));
  };

  // --- Stops tab (spec §4.1): flat, ordered list of every stop — one Card
  // each, never grouped/nested by rider. ------------------------------------
  const stopsTabContent = (
    <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
      {manifestLoading ? (
        <AppText muted variant="caption">
          Loading…
        </AppText>
      ) : !stopResolutions.length ? (
        <AppText muted variant="caption">
          No stops on this trip yet.
        </AppText>
      ) : (
        <View style={{ gap: spacing.md }}>
          {stopResolutions.map(({ stop, riders, resolved }, index) => {
            const isNextStop = nextStop?.id === stop.id;
            const status: 'reached' | 'next' | 'upcoming' = resolved ? 'reached' : isNextStop ? 'next' : 'upcoming';
            const distanceLabel =
              isNextStop && nextStopDistanceM !== null ? formatDistance(nextStopDistanceM / 1000) : null;
            const people = riders.map((r) => r.user.name).join(' · ');
            return (
              <StopCard
                key={stop.id}
                stop={stop}
                sequence={index + 1}
                status={status}
                isSelected={selectedStopId === stop.id}
                isNextStop={isNextStop}
                distanceLabel={distanceLabel}
                people={people}
                nextStopArrived={nextStopArrived}
                canConfirmArrival={canConfirmArrival}
                arrivedPending={recordEvent.isPending}
                onReach={() => {
                  // Only ever calls handleArrived with the real nextStop —
                  // never selectedStopId/previewStop — regardless of which
                  // card this callback was built for.
                  if (nextStop && stop.id === nextStop.id) handleArrived(nextStop);
                }}
                onSelect={() => setSelectedStopId(stop.id)}
              />
            );
          })}
        </View>
      )}
    </ScrollView>
  );

  // --- Riders tab (spec §4.2): one Card per rider. --------------------------
  const ridersTabContent = (
    <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
      {manifestLoading ? (
        <AppText muted variant="caption">
          Loading…
        </AppText>
      ) : !mergedRiders.length ? (
        <AppText muted variant="caption">
          No confirmed riders on this trip.
        </AppText>
      ) : (
        <View style={{ gap: spacing.md }}>
          {mergedRiders.map((rider) => (
            <RiderCard
              key={rider.id}
              rider={rider}
              noShow={noShowIds.has(rider.id)}
              pending={recordEvent.isPending}
              unreadCount={unreadCounts[rider.id] ?? 0}
              onAction={() =>
                handleRiderEvent(rider.id, rider.pickupConfirmedAt ? TripEventType.DROPOFF : TripEventType.PICKUP)
              }
              onChat={() => openChat(rider.id, rider.user.name)}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );

  // --- Details tab (spec §4.3): exactly three text-only Cards. --------------
  const detailsTabContent = (
    <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
      <View style={{ gap: spacing.md }}>
        <AppCard>
          <AppText variant="label" style={{ marginBottom: spacing.md }}>
            Trip summary
          </AppText>
          <View style={{ gap: spacing.md }}>
            <DetailRow label="Route" value={`${trip.originCity} → ${trip.destinationCity}`} />
            <DetailRow label="Started" value={startedLabel} />
            <DetailRow label="Stops" value={`${pickupStopsCount} pickups · ${dropoffStopsCount} dropoffs`} />
            <DetailRow label="Riders" value={`${mergedRiders.length} riders · ${totalSeats} seats`} />
          </View>
        </AppCard>

        <AppCard>
          <AppText variant="label" style={{ marginBottom: spacing.md }}>
            Vehicle
          </AppText>
          <View style={{ gap: spacing.md }}>
            <DetailRow label="Vehicle" value={`${titleCase(trip.userVehicle.make)} ${titleCase(trip.userVehicle.model)}`} />
            <DetailRow label="Plate" value={trip.userVehicle.plateNumber} />
            <DetailRow label="Seats offered" value={String(trip.availableSeats)} />
          </View>
        </AppCard>

        <AppCard>
          <AppText variant="label" style={{ marginBottom: spacing.md }}>
            Earnings
          </AppText>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }}>
            <AppText variant="title" color={colors.primary}>
              {formatPrice(earningsEstimate)}
            </AppText>
            <AppText muted variant="caption">
              / {totalSeats} seat{totalSeats !== 1 ? 's' : ''}
            </AppText>
          </View>
          <AppText muted variant="caption" style={{ marginTop: spacing.sm }}>
            Estimate only — collected from riders directly.
          </AppText>
        </AppCard>
      </View>
    </ScrollView>
  );

  const chatRider = chatTarget ? mergedRiders.find((r) => r.id === chatTarget.id) : undefined;

  return (
    <AppScreen edges={['left', 'right', 'bottom']}>
      {/* Ride lock (spec §6): the hardware/gesture back effect above already
          swallows the physical back button, but the native stack header's own
          back chevron and iOS/Android swipe-back gesture are a SEPARATE exit
          path it doesn't touch — suppress both here, only while the ride is
          actually in progress, so "End ride" stays the only way out. Restored
          automatically once the ride is no longer in progress. */}
      <Stack.Screen options={{ headerShown: !effectiveInProgress, gestureEnabled: !effectiveInProgress, title: 'Trip Details' }} />
      {showManifest ? (
        <>
          <View style={{ flex: 1 }}>
            {/* Ride header (spec §2) — fixed. */}
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
                  Active ride · today
                </AppText>
                <AppText variant="title" numberOfLines={1} style={{ textTransform: 'capitalize' }}>
                  {trip.originCity} → {trip.destinationCity}
                </AppText>
              </View>
              <StatusBadge label={rideBadge.label} tone={rideBadge.tone} />
            </View>

            {offlineQueue.pendingCount > 0 ? (
              <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.surfaceAlt }}>
                <AppText variant="caption">
                  {offlineQueue.flushing
                    ? 'Syncing…'
                    : `${offlineQueue.pendingCount} action${offlineQueue.pendingCount !== 1 ? 's' : ''} queued — no connection yet. They'll sync automatically once you're back online.`}
                </AppText>
              </View>
            ) : null}

            {/* Map section: pinned, ~45% of the remaining height (never
                scrolled), plus its bottom-anchored next-stop banner. */}
            <View style={{ flex: 0.45, position: 'relative' }}>
              <LiveTripMap
                stops={mapStops}
                driverPosition={effectiveInProgress && currentPosition ? { lat: currentPosition.lat, lng: currentPosition.lng } : null}
                isConnected={isConnected}
                lastUpdateAt={lastLocationUpdateAt}
                routePolyline={effectiveInProgress ? routeDirections?.polyline : undefined}
                onSelectStop={(stopId) => setSelectedStopId(stopId)}
              />

              <View
                style={{
                  position: 'absolute',
                  left: spacing.md,
                  right: spacing.md,
                  bottom: spacing.md,
                  backgroundColor: colors.surface,
                  borderRadius: radii.card,
                  padding: spacing.md,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                {effectiveCompleted ? (
                  <AppText variant="label">Trip completed</AppText>
                ) : previewStop ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <AppText muted variant="caption" numberOfLines={1}>
                        {navCaption}
                      </AppText>
                      <AppText variant="subtitle" numberOfLines={1}>
                        {previewStop.type === 'PICKUP' ? 'Pickup' : 'Dropoff'} · {previewStop.label}
                      </AppText>
                    </View>
                    <AppButton title="Navigate" variant="secondary" fullWidth={false} onPress={() => handleNavigate(previewStop)} />
                  </View>
                ) : null}

                {/* Reached control — its own element, tied strictly to the
                    real nextStop, never previewStop/selectedStopId. */}
                {!effectiveCompleted && nextStop ? (
                  <View style={{ marginTop: previewStop ? spacing.sm : 0 }}>
                    {locationDenied ? (
                      <AppText muted variant="caption">
                        Location access is needed to confirm arrival at this stop. Enable location permission for this
                        app in your device settings.
                      </AppText>
                    ) : (
                      <>
                        <AppButton
                          title={nextStopArrived ? 'Already reached' : 'Reached'}
                          loading={recordEvent.isPending}
                          disabled={nextStopArrived || !canConfirmArrival}
                          onPress={() => handleArrived(nextStop)}
                        />
                        {!nextStopArrived && !canConfirmArrival ? (
                          <AppText muted variant="caption" style={{ marginTop: spacing.xs }}>
                            Get within {ARRIVAL_RADIUS_METERS}m of this stop to confirm arrival.
                          </AppText>
                        ) : null}
                      </>
                    )}
                  </View>
                ) : null}
              </View>
            </View>

            {/* Tabs + tab content: pinned tab row, independently scrolling
                content. */}
            <View style={{ flex: 0.55 }}>
              <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm }}>
                <TabBar tabs={DRIVER_TABS} activeKey={activeTab} onChange={(key) => setActiveTab(key as DriverTab)} />
              </View>
              <View style={{ flex: 1 }}>
                {/* All three stay mounted (display toggled, not conditionally
                    rendered) so switching tabs never resets scroll position. */}
                <View style={{ flex: 1, display: activeTab === 'stops' ? 'flex' : 'none' }}>{stopsTabContent}</View>
                <View style={{ flex: 1, display: activeTab === 'riders' ? 'flex' : 'none' }}>{ridersTabContent}</View>
                <View style={{ flex: 1, display: activeTab === 'details' ? 'flex' : 'none' }}>{detailsTabContent}</View>
              </View>
            </View>

            {actionError ? (
              <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>
                <AppText color={colors.danger} variant="caption">
                  {actionError}
                </AppText>
              </View>
            ) : null}

            {/* Action bar (spec §6): pinned. The single "End ride" trigger —
                always present/reachable, never swapped for a per-stop action. */}
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
                <AppText variant="label">
                  {doneStopsCount} of {totalStopsCount} stops done
                </AppText>
                <AppText muted variant="caption" numberOfLines={1} style={{ textTransform: 'capitalize' }}>
                  Arriving {trip.destinationCity}
                </AppText>
              </View>
              <AppButton
                title="End ride"
                variant="danger"
                fullWidth={false}
                disabled={effectiveCompleted}
                onPress={() => setEndConfirming(true)}
              />
            </View>
          </View>

          {/* End-ride confirmation sheet (spec §6) — the ride's only End
              trigger/confirm-flow; handleEnd is unchanged. */}
          <Modal visible={endConfirming} animationType="slide" transparent onRequestClose={() => setEndConfirming(false)}>
            <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
              <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: spacing.lg }}>
                <AppText variant="subtitle" style={{ marginBottom: spacing.xs }}>
                  End this ride?
                </AppText>
                <AppText muted variant="caption" style={{ marginBottom: spacing.md }}>
                  Any rider you haven&apos;t tapped pickup/drop-off for will be marked as completed automatically.
                </AppText>
                {actionError ? (
                  <AppText color={colors.danger} variant="caption" style={{ marginBottom: spacing.md }}>
                    {actionError}
                  </AppText>
                ) : null}
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <AppButton title="Not yet" variant="secondary" onPress={() => setEndConfirming(false)} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <AppButton title="End ride" variant="danger" loading={endTrip.isPending} onPress={handleEnd} />
                  </View>
                </View>
              </View>
            </View>
          </Modal>

          {/* Chat (spec §5) — modal sheet opened per-rider from the Riders
              tab, always mounted (visible toggled) so ChatModalSheet/ChatPanel
              never has to remount on every open/close. */}
          <ChatModalSheet
            visible={!!chatTarget}
            onClose={() => setChatTarget(null)}
            tripInquiryId={chatTarget?.id ?? ''}
            riderName={chatTarget?.name ?? ''}
            pickupLabel={chatRider?.pickupStop?.label ?? '—'}
            dropoffLabel={chatRider?.dropoffStop?.label ?? '—'}
          />
        </>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <AppText variant="title" style={{ textTransform: 'capitalize', flex: 1, marginRight: spacing.md }}>
              {trip.originCity} → {trip.destinationCity}
            </AppText>
            <StatusBadge label={statusMeta.label} tone={statusMeta.tone} />
          </View>

          {offlineQueue.pendingCount > 0 ? (
            <AppCard style={{ marginTop: spacing.md, backgroundColor: colors.surfaceAlt }}>
              <AppText variant="caption">
                {offlineQueue.flushing
                  ? 'Syncing…'
                  : `${offlineQueue.pendingCount} action${offlineQueue.pendingCount !== 1 ? 's' : ''} queued — no connection yet. They'll sync automatically once you're back online.`}
              </AppText>
            </AppCard>
          ) : null}

          {trip.rejectionReason ? (
            <AppCard style={{ marginTop: spacing.lg }}>
              <AppText variant="label" color={colors.danger}>
                Rejection reason
              </AppText>
              <AppText muted style={{ marginTop: spacing.xs }}>
                {trip.rejectionReason}
              </AppText>
            </AppCard>
          ) : null}
          {trip.cancelReason ? (
            <AppCard style={{ marginTop: spacing.lg }}>
              <AppText variant="label">Cancellation reason</AppText>
              <AppText muted style={{ marginTop: spacing.xs }}>
                {trip.cancelReason}
              </AppText>
            </AppCard>
          ) : null}

          <AppCard style={{ marginTop: spacing.lg }}>
            <Row label="Departure" value={formatDate(trip.departureAt)} />
            <Row label="Pickup point" value={trip.pickupPoint} />
            {trip.dropoffPoint ? <Row label="Drop-off point" value={trip.dropoffPoint} /> : null}
            <Row label="Available seats" value={String(trip.availableSeats)} />
            <Row label="Price / seat" value={formatPrice(trip.pricePerSeat)} />
            <Row label="Contact number" value={trip.contactNumber} />
          </AppCard>

          <AppCard style={{ marginTop: spacing.lg }}>
            <AppText variant="label" style={{ marginBottom: spacing.sm }}>
              Vehicle
            </AppText>
            {trip.userVehicle.images.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }}>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  {trip.userVehicle.images.map((image) => (
                    <View key={image.id} style={{ width: 112, height: 80, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.surfaceAlt }}>
                      <Image source={{ uri: image.url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                    </View>
                  ))}
                </View>
              </ScrollView>
            ) : null}
            <Row
              label="Vehicle"
              value={`${titleCase(trip.userVehicle.make)} ${titleCase(trip.userVehicle.model)}`}
            />
            <Row label="Plate" value={trip.userVehicle.plateNumber} />
          </AppCard>

          {trip.notes ? (
            <AppCard style={{ marginTop: spacing.lg }}>
              <AppText variant="label">Notes</AppText>
              <AppText muted style={{ marginTop: spacing.xs }}>
                {trip.notes}
              </AppText>
            </AppCard>
          ) : null}

          {trip.status === TripStatus.ACTIVE && !effectiveInProgress ? (
          <AppCard style={{ marginTop: spacing.lg }}>
            <AppText variant="label" style={{ marginBottom: spacing.sm }}>
              Incoming requests
            </AppText>
            {inquiriesLoading ? (
              <AppText muted variant="caption">
                Loading…
              </AppText>
            ) : !inquiriesRes?.data.length ? (
              <AppText muted variant="caption">
                No requests yet — riders who ask for a seat will show up here.
              </AppText>
            ) : (
              inquiriesRes.data.map((inquiry) => (
                <View
                  key={inquiry.id}
                  style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, marginTop: spacing.sm }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <AppText variant="caption" style={{ flex: 1, marginRight: spacing.sm }}>
                      {inquiry.user.name} · {inquiry.requestedSeats} seat{inquiry.requestedSeats !== 1 ? 's' : ''}
                    </AppText>
                    <StatusBadge
                      label={tripInquiryStatusMeta[inquiry.status].label}
                      tone={tripInquiryStatusMeta[inquiry.status].tone}
                    />
                  </View>
                  {inquiry.message ? (
                    <AppText muted variant="caption" style={{ marginTop: spacing.xs }}>
                      &ldquo;{inquiry.message}&rdquo;
                    </AppText>
                  ) : null}

                  {inquiry.status === 'PENDING' && decliningId !== inquiry.id ? (
                    <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                      <View style={{ flex: 1 }}>
                        <AppButton
                          title="Accept"
                          loading={updateInquiryStatus.isPending}
                          onPress={() =>
                            updateInquiryStatus.mutate({ id: inquiry.id, data: { newStatus: TripInquiryStatus.ACCEPTED } })
                          }
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <AppButton
                          title="Decline"
                          variant="secondary"
                          onPress={() => {
                            setDeclineNote('');
                            setDecliningId(inquiry.id);
                          }}
                        />
                      </View>
                    </View>
                  ) : null}

                  {decliningId === inquiry.id ? (
                    <View style={{ marginTop: spacing.sm }}>
                      <AppInput
                        placeholder="Optional note for the rider"
                        value={declineNote}
                        onChangeText={setDeclineNote}
                      />
                      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                        <View style={{ flex: 1 }}>
                          <AppButton title="Keep pending" variant="secondary" onPress={() => setDecliningId(null)} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <AppButton
                            title="Confirm decline"
                            variant="danger"
                            loading={updateInquiryStatus.isPending}
                            onPress={async () => {
                              await updateInquiryStatus.mutateAsync({
                                id: inquiry.id,
                                data: { newStatus: TripInquiryStatus.REJECTED, note: declineNote || undefined },
                              });
                              setDecliningId(null);
                            }}
                          />
                        </View>
                      </View>
                    </View>
                  ) : null}
                </View>
              ))
            )}
          </AppCard>
          ) : null}

          {actionError ? (
            <AppText color={colors.danger} style={{ marginTop: spacing.md }}>
              {actionError}
            </AppText>
          ) : null}

          {actions.includes('start') ? (
            startConfirming ? (
              <AppCard style={{ marginTop: spacing.xl }}>
                <AppText variant="label">Start this trip?</AppText>
                <AppText muted variant="caption" style={{ marginTop: spacing.xs }}>
                  This locks in your currently accepted riders as the manifest and removes the trip from search.
                </AppText>
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <AppButton title="Not yet" variant="secondary" onPress={() => setStartConfirming(false)} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <AppButton title="Start trip" loading={startTrip.isPending} onPress={handleStart} />
                  </View>
                </View>
              </AppCard>
            ) : (
              <AppButton
                title="Start trip"
                onPress={() => setStartConfirming(true)}
                style={{ marginTop: spacing.xl }}
              />
            )
          ) : null}

          {actions.includes('cancel') ? (
            <AppButton
              title="Cancel trip"
              variant="danger"
              loading={cancelTrip.isPending}
              onPress={handleCancel}
              style={{ marginTop: spacing.md }}
            />
          ) : null}
        </ScrollView>
      )}
    </AppScreen>
  );
}

// --- Stops tab card (spec §4.1) ---------------------------------------------
function StopSequenceDot({ status, sequence }: { status: 'reached' | 'next' | 'upcoming'; sequence: number }) {
  const { colors } = useTheme();
  const bg = status === 'reached' ? REACHED_DOT_BG : status === 'next' ? colors.primary : UPCOMING_DOT_BG;
  const fg = status === 'reached' ? REACHED_DOT_FG : status === 'next' ? colors.primaryText : colors.textMuted;
  return (
    <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: bg }}>
      <AppText variant="label" color={fg}>
        {sequence}
      </AppText>
    </View>
  );
}

function StopCard({
  stop,
  sequence,
  status,
  isSelected,
  isNextStop,
  distanceLabel,
  people,
  nextStopArrived,
  canConfirmArrival,
  arrivedPending,
  onReach,
  onSelect,
}: {
  stop: ManifestRouteStop;
  sequence: number;
  status: 'reached' | 'next' | 'upcoming';
  isSelected: boolean;
  isNextStop: boolean;
  distanceLabel: string | null;
  people: string;
  nextStopArrived: boolean;
  canConfirmArrival: boolean;
  arrivedPending: boolean;
  onReach: () => void;
  onSelect: () => void;
}) {
  const { colors, spacing } = useTheme();
  const reached = status === 'reached';
  const kindLabel = stop.type === 'PICKUP' ? 'Pickup' : 'Dropoff';
  const kindColor = stop.type === 'PICKUP' ? colors.primary : colors.text;
  const badge =
    status === 'reached'
      ? { label: 'Reached', tone: 'complete' as const }
      : status === 'next'
        ? { label: 'Next', tone: 'accent' as const }
        : { label: 'Upcoming', tone: 'neutral' as const };

  // Only the real next stop's button is ever actionable — its
  // enabled/disabled state reads nextStopArrived/canConfirmArrival, both
  // computed strictly from nextStop upstream. Every other stop's button is
  // permanently disabled, regardless of this card's own selection state.
  const buttonReached = reached || (isNextStop && nextStopArrived);
  const reachDisabled = !isNextStop || nextStopArrived || !canConfirmArrival;

  return (
    <Pressable onPress={onSelect} accessibilityRole="button">
      <AppCard style={{ opacity: reached ? 0.7 : 1, borderColor: isSelected ? colors.primary : colors.border }}>
        <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
          <StopSequenceDot status={status} sequence={sequence} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <AppText variant="label" color={kindColor}>
                {kindLabel}
              </AppText>
              {distanceLabel ? (
                <AppText muted variant="caption">
                  {distanceLabel}
                </AppText>
              ) : null}
            </View>
            <AppText variant="subtitle" numberOfLines={1}>
              {stop.label}
            </AppText>
            {people ? (
              <AppText muted variant="caption" numberOfLines={1}>
                {people}
              </AppText>
            ) : null}
          </View>
          <StatusBadge label={badge.label} tone={badge.tone} />
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
          <View style={{ flex: 1 }}>
            <AppButton
              title={buttonReached ? 'Reached' : 'I reached'}
              variant={isNextStop ? 'primary' : 'outline'}
              disabled={reachDisabled}
              loading={isNextStop && arrivedPending}
              onPress={onReach}
            />
          </View>
          <View style={{ flex: 1 }}>
            <AppButton title={isSelected ? 'Showing on map' : 'Show on map'} variant="ghost" onPress={onSelect} />
          </View>
        </View>
      </AppCard>
    </Pressable>
  );
}

// --- Riders tab card (spec §4.2) --------------------------------------------
function RiderCard({
  rider,
  noShow,
  pending,
  unreadCount,
  onAction,
  onChat,
}: {
  rider: ManifestRider;
  noShow: boolean;
  pending: boolean;
  unreadCount: number;
  onAction: () => void;
  onChat: () => void;
}) {
  const { spacing } = useTheme();
  const pickedUp = !!rider.pickupConfirmedAt;
  const droppedOff = !!rider.droppedOffAt;
  const initials =
    rider.user.name
      .trim()
      .split(/\s+/)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('')
      .slice(0, 2) || '?';

  const phaseLabel = droppedOff ? 'Trip finished' : pickedUp ? 'On board' : noShow ? 'No-show logged' : 'Awaiting pickup';
  const meta = `${rider.requestedSeats} seat${rider.requestedSeats !== 1 ? 's' : ''} · ${phaseLabel}`;
  const stopLine = `${rider.pickupStop?.label ?? '—'} → ${rider.dropoffStop?.label ?? '—'}`;
  const badge = droppedOff
    ? { label: 'Dropped', tone: 'complete' as const }
    : pickedUp
      ? { label: 'On Board', tone: 'success' as const }
      : { label: 'Awaiting Pickup', tone: 'warning' as const };
  const actionTitle = droppedOff || pickedUp ? 'Dropped off' : 'Picked up';
  const chatTitle = unreadCount > 0 ? `Chat · ${unreadCount}` : 'Chat';

  return (
    <AppCard>
      <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: AVATAR_BG,
          }}
        >
          <AppText variant="label" color={AVATAR_FG}>
            {initials}
          </AppText>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText variant="subtitle" numberOfLines={1}>
            {rider.user.name}
          </AppText>
          <AppText muted variant="caption" numberOfLines={1}>
            {meta}
          </AppText>
          <AppText muted variant="caption" numberOfLines={1}>
            {stopLine}
          </AppText>
        </View>
        <StatusBadge label={badge.label} tone={badge.tone} />
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
        <View style={{ flex: 1 }}>
          <AppButton
            title={actionTitle}
            variant={droppedOff ? 'outline' : 'primary'}
            disabled={droppedOff}
            loading={pending}
            onPress={onAction}
          />
        </View>
        <View style={{ flex: 1 }}>
          <AppButton title={chatTitle} variant="outline" onPress={onChat} />
        </View>
      </View>
    </AppCard>
  );
}

// --- Details tab row (spec §4.3) --------------------------------------------
function DetailRow({ label, value }: { label: string; value: string }) {
  const { colors, spacing } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
      <AppText muted variant="body">
        {label}
      </AppText>
      <AppText variant="body" color={colors.text} style={{ textAlign: 'right', flexShrink: 1 }}>
        {value}
      </AppText>
    </View>
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
