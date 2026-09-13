import { useEffect, useRef, useState } from 'react';
import { BackHandler, ScrollView, View } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
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
import { LiveTripMap } from '../../../features/liveRide/components/LiveTripMap';
import { ChatSheet } from '../../../features/liveRide/components/ChatSheet';
import { geoApi, type RouteDirections } from '../../../api/geo.api';
import type { ManifestRider, ManifestRouteStop, RecordTripEventPayload } from '../../../api/trips.api';
import { useTripInquiryInbox, useUpdateTripInquiryStatus } from '../../../features/trip-inquiries/queries';
import { AppButton, AppCard, AppInput, AppScreen, AppText, ErrorState, LoadingState, StatusBadge } from '../../../components/ui';
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
import { formatDate, formatPrice, titleCase } from '../../../utils/format';
import { normalizeApiError } from '../../../api/errors';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

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

interface WatchedPosition {
  lat: number;
  lng: number;
  accuracy: number | null;
  mocked?: boolean;
}

export default function MyTripDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, spacing, radii } = useTheme();
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
  // (rather than one per rider) guarantees only one ChatSheet is ever
  // mounted-visible/joined at a time; opening a different rider's chat just
  // replaces this value (and the modal being full-screen means there's no
  // way to tap a second rider's Chat button while one is already open).
  const [chatTarget, setChatTarget] = useState<{ id: string; name: string } | null>(null);
  // ISO timestamp of the last location-watch fix — fed to LiveTripMap so it
  // can show "last known location as of ..." once the socket disconnects.
  const [lastLocationUpdateAt, setLastLocationUpdateAt] = useState<string | null>(null);
  // Turn-by-turn overlay (polyline + next-turn text) for the current
  // "next stop" leg — see the fetch effect below for exactly when this is
  // populated.
  const [routeDirections, setRouteDirections] = useState<RouteDirections | null>(null);
  // Which stop id directions have already been fetched for — guards the
  // effect below so the endpoint is called once per distinct next-stop,
  // never on a timer or on every GPS tick.
  const fetchedRouteForStopId = useRef<string | null>(null);
  // Mirror the latest nextStop/currentPosition for the fetch effect further
  // down to read without listing them as dependencies — see that effect's
  // own comment for why.
  const nextStopRef = useRef<ManifestRouteStop | null>(null);
  const currentPositionRef = useRef<WatchedPosition | null>(null);
  const { isConnected, isReady, joinTrip, leaveTrip, emitLocation } = useRideSocket();

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

  const matchedRiderIds = new Set<string>();
  const stopGroups = (manifest?.routeStops ?? []).map((stop) => {
    const stopRiders = mergedRiders.filter((rider) =>
      stop.type === 'PICKUP' ? rider.pickupStop?.id === stop.id : rider.dropoffStop?.id === stop.id,
    );
    stopRiders.forEach((rider) => matchedRiderIds.add(rider.id));
    return { stop, riders: stopRiders };
  });
  const otherRiders = mergedRiders.filter((rider) => !matchedRiderIds.has(rider.id));

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

  // `nextStop`/`currentPosition` are read at fetch time via these refs rather
  // than as effect dependencies — both are new object references on every
  // render (nextStop is recomputed above, currentPosition ticks every ~4s
  // from the GPS watch), so depending on them directly would re-run the fetch
  // effect below (and re-fire its cleanup) far more often than "the target
  // stop actually changed", racing a still-in-flight fetch against its own
  // cancellation. Kept current via their own no-dependency-array effect
  // (runs after every render, before the fetch effect below since it's
  // declared first) rather than writing the refs directly in the render body
  // — required by this app's React Compiler lint rule (react-hooks/refs).
  useEffect(() => {
    nextStopRef.current = nextStop;
    currentPositionRef.current = currentPosition;
  });

  // Route polyline + next-turn text for the map overlay, for the leg from the
  // driver's current position to `nextStop`. Depends only on effectiveInProgress,
  // nextStop's id (a stable primitive, unlike the nextStop object itself), and
  // whether a GPS fix exists YET (a boolean, not the position itself) — so this
  // only re-runs when the target stop genuinely changes, or once when the very
  // first fix arrives, never on every subsequent GPS tick. `fetchedRouteForStopId`
  // additionally guards against firing twice for the same stop id. A failed call
  // or a "no route" response just clears the overlay — this is a nice-to-have,
  // never something that blocks the Arrived/Pickup/Dropoff flow.
  useEffect(() => {
    const stop = nextStopRef.current;
    if (!effectiveInProgress || !stop) return;
    if (fetchedRouteForStopId.current === stop.id) return;
    const position = currentPositionRef.current;
    if (!position) return; // no fix yet — retried once `!!currentPosition` flips true below

    fetchedRouteForStopId.current = stop.id;
    // Clear the previous stop's directions immediately so a stale "next turn"
    // banner/polyline never lingers on screen while the new leg is fetched.
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
  }, [effectiveInProgress, nextStop?.id, !!currentPosition]);

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

  return (
    <AppScreen edges={['left', 'right', 'bottom']}>
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

        {effectiveInProgress && nextStop && routeDirections?.steps[0] ? (
          <AppCard style={{ marginTop: spacing.lg, backgroundColor: colors.surfaceAlt }}>
            <AppText variant="label">Next turn</AppText>
            <AppText muted variant="caption" style={{ marginTop: spacing.xs }}>
              {routeDirections.steps[0].instruction} — {Math.round(routeDirections.steps[0].distanceMeters)}m
            </AppText>
          </AppCard>
        ) : null}

        {effectiveInProgress && nextStop ? (
          <AppCard style={{ marginTop: spacing.lg }}>
            <AppText variant="label">Next stop</AppText>
            <AppText muted variant="caption" style={{ marginTop: spacing.xs }}>
              {nextStop.label} · {nextStop.type === 'PICKUP' ? 'Pickup' : 'Drop-off'}
            </AppText>
            {locationDenied ? (
              <AppText muted variant="caption" style={{ marginTop: spacing.sm }}>
                Location access is needed to confirm arrival at this stop. Enable location permission for this app in
                your device settings.
              </AppText>
            ) : (
              <>
                <AppButton
                  title={nextStopArrived ? 'Arrival confirmed' : 'Arrived'}
                  loading={recordEvent.isPending}
                  disabled={nextStopArrived || !canConfirmArrival}
                  onPress={() => handleArrived(nextStop)}
                  style={{ marginTop: spacing.sm }}
                />
                {!nextStopArrived && !canConfirmArrival ? (
                  <AppText muted variant="caption" style={{ marginTop: spacing.xs }}>
                    Get within {ARRIVAL_RADIUS_METERS}m of this stop to confirm arrival.
                  </AppText>
                ) : null}
              </>
            )}
          </AppCard>
        ) : null}

        {effectiveInProgress ? (
          <View style={{ marginTop: spacing.lg, height: 260, borderRadius: radii.card, overflow: 'hidden' }}>
            <LiveTripMap
              stops={manifest?.routeStops ?? []}
              driverPosition={currentPosition ? { lat: currentPosition.lat, lng: currentPosition.lng } : null}
              isConnected={isConnected}
              lastUpdateAt={lastLocationUpdateAt}
              routePolyline={routeDirections?.polyline}
            />
          </View>
        ) : null}

        {showManifest ? (
          <AppCard style={{ marginTop: spacing.lg }}>
            <AppText variant="label" style={{ marginBottom: spacing.sm }}>
              Manifest
            </AppText>
            {manifestLoading ? (
              <AppText muted variant="caption">
                Loading…
              </AppText>
            ) : !mergedRiders.length ? (
              <AppText muted variant="caption">
                No confirmed riders on this trip.
              </AppText>
            ) : (
              <>
                {stopGroups.map(({ stop, riders }) =>
                  riders.length ? (
                    <View key={stop.id} style={{ marginTop: spacing.md }}>
                      <AppText variant="label" style={{ marginBottom: spacing.xs }}>
                        {stop.label} · {stop.type === 'PICKUP' ? 'Pickup' : 'Drop-off'}
                      </AppText>
                      {riders.map((rider) => (
                        <ManifestRiderRow
                          key={`${stop.id}:${rider.id}`}
                          rider={rider}
                          tripInProgress={effectiveInProgress}
                          noShow={noShowIds.has(rider.id)}
                          pending={recordEvent.isPending}
                          onAction={(type) => handleRiderEvent(rider.id, type)}
                          onChat={() => setChatTarget({ id: rider.id, name: rider.user.name })}
                        />
                      ))}
                    </View>
                  ) : null,
                )}
                {otherRiders.length ? (
                  <View style={{ marginTop: spacing.md }}>
                    <AppText variant="label" style={{ marginBottom: spacing.xs }}>
                      Other
                    </AppText>
                    {otherRiders.map((rider) => (
                      <ManifestRiderRow
                        key={rider.id}
                        rider={rider}
                        tripInProgress={effectiveInProgress}
                        noShow={noShowIds.has(rider.id)}
                        pending={recordEvent.isPending}
                        onAction={(type) => handleRiderEvent(rider.id, type)}
                        onChat={() => setChatTarget({ id: rider.id, name: rider.user.name })}
                      />
                    ))}
                  </View>
                ) : null}
              </>
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

        {actions.includes('end') ? (
          endConfirming ? (
            <AppCard style={{ marginTop: spacing.xl }}>
              <AppText variant="label">End this trip?</AppText>
              <AppText muted variant="caption" style={{ marginTop: spacing.xs }}>
                Any rider you haven&apos;t tapped pickup/drop-off for will be marked as completed automatically.
              </AppText>
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <AppButton title="Not yet" variant="secondary" onPress={() => setEndConfirming(false)} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppButton title="End trip" loading={endTrip.isPending} onPress={handleEnd} />
                </View>
              </View>
            </AppCard>
          ) : (
            <AppButton
              title="End trip"
              onPress={() => setEndConfirming(true)}
              style={{ marginTop: spacing.xl }}
            />
          )
        ) : null}
      </ScrollView>

      <ChatSheet
        visible={chatTarget !== null}
        onClose={() => setChatTarget(null)}
        tripInquiryId={chatTarget?.id ?? ''}
        otherPartyName={chatTarget?.name ?? ''}
      />
    </AppScreen>
  );
}

function ManifestRiderRow({
  rider,
  tripInProgress,
  noShow,
  pending,
  onAction,
  onChat,
}: {
  rider: ManifestRider;
  tripInProgress: boolean;
  noShow: boolean;
  pending: boolean;
  onAction: (type: TripEventType) => void;
  onChat: () => void;
}) {
  const { colors, spacing } = useTheme();
  const pickedUp = !!rider.pickupConfirmedAt;
  const droppedOff = !!rider.droppedOffAt;
  const autoResolved = rider.pickupSource === PickupSource.AUTO_ON_TRIP_END;

  return (
    <View
      style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, marginTop: spacing.sm }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <AppText variant="caption" style={{ flex: 1, marginRight: spacing.sm }}>
          {rider.user.name} · {rider.requestedSeats} seat{rider.requestedSeats !== 1 ? 's' : ''}
          {rider.user.phone ? ` · ${rider.user.phone}` : ''}
        </AppText>
        {droppedOff ? (
          <StatusBadge label={autoResolved ? 'Auto-completed' : 'Dropped off'} tone="complete" />
        ) : pickedUp ? (
          <StatusBadge label="Picked up" tone="success" />
        ) : noShow ? (
          <StatusBadge label="No-show logged" tone="warning" />
        ) : (
          <StatusBadge label="Waiting" tone="neutral" />
        )}
      </View>
      {rider.pickupNote ? (
        <AppText muted variant="caption" style={{ marginTop: spacing.xs }}>
          Pickup note: {rider.pickupNote}
        </AppText>
      ) : null}
      {pickedUp && !autoResolved ? (
        <AppText muted variant="caption" style={{ marginTop: spacing.xs }}>
          Picked up {formatTime(rider.pickupConfirmedAt as string)}
          {droppedOff ? ` · Dropped off ${formatTime(rider.droppedOffAt as string)}` : ''}
        </AppText>
      ) : null}

      {/* Every manifest rider is, by construction, an ACCEPTED inquiry — chat
          is always available here regardless of trip/pickup/dropoff progress. */}
      <View style={{ alignItems: 'flex-start', marginTop: spacing.sm }}>
        <AppButton title="Chat" variant="secondary" fullWidth={false} onPress={onChat} />
      </View>

      {tripInProgress && !pickedUp && !noShow ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <AppButton title="Picked up" loading={pending} onPress={() => onAction(TripEventType.PICKUP)} />
          </View>
          <View style={{ flex: 1 }}>
            <AppButton
              title="No-show"
              variant="secondary"
              onPress={() => onAction(TripEventType.NO_SHOW)}
            />
          </View>
        </View>
      ) : null}

      {tripInProgress && pickedUp && !droppedOff ? (
        <AppButton
          title="Dropped off"
          loading={pending}
          onPress={() => onAction(TripEventType.DROPOFF)}
          style={{ marginTop: spacing.sm }}
        />
      ) : null}
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
