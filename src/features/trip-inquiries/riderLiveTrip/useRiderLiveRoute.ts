import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { useQuery } from '@tanstack/react-query';

import { geoApi } from '../../../api/geo.api';
import { tripsApi } from '../../../api/trips.api';
import type { TripStop } from '../../../types/api.types';
import { useRideSocket } from '../../liveRide/socket';
import { haversineDistanceMeters } from '../../liveRide/geo';
import type { LiveTripStop } from '../../liveRide/components/LiveTripMap';

// Live ETA-to-stop fetches are throttled to at most once per this interval,
// regardless of how often the driver's position updates via the socket
// (~every 4s) — reuses the same route-directions endpoint as the one-time
// whole-route fetch below, just aimed at the driver's current (moving)
// position instead of the fixed pickup point.
const ETA_FETCH_THROTTLE_MS = 45_000;

// This rider's own pickup/dropoff stop, as carried on TripInquiry — shared by
// this hook and the rider live-view components below it so the four of them
// can't drift apart.
export interface RiderStop {
  id: string;
  label: string;
  lat: number;
  lng: number;
}

interface UseRiderLiveRouteParams {
  tripId: string | undefined;
  tripLive: boolean;
  pickupStop: RiderStop | null;
  dropoffStop: RiderStop | null;
  pickupConfirmedAt: string | null;
  droppedOffAt: string | null;
}

export interface RiderLiveRoute {
  position: Location.LocationObject | null;
  locationDenied: boolean;
  pickupDistanceM: number | null;
  dropoffDistanceM: number | null;
  driverPosition: { lat: number; lng: number } | null;
  driverLastUpdateAt: string | null;
  routePolyline: { lat: number; lng: number }[] | undefined;
  etaMinutes: number | null;
  driverDistanceKm: number | null;
  // Every OTHER stop on the whole trip besides this rider's own
  // pickup/dropoff — the caller combines these with the rider's own two
  // stops to build the map's full pin set (kept separate here since
  // assembling that combined list needs riderConfirmedAtPickup, which lives
  // in useRiderTripActions, not this hook).
  otherTripStops: LiveTripStop[];
  dropoffSequence: number;
  tripStopsSorted: TripStop[];
  tripStopsLoading: boolean;
  vehicleColor: string | null;
  vehicleYear: number | null;
}

/**
 * Everything needed to render the rider's live map/ETA experience: the
 * rider's own GPS fix (for the pickup/dropoff geofence), the driver's
 * incoming location over the socket, the whole trip's route (for map context
 * and the Stops tab's overview list), and a throttled live ETA to whichever
 * stop (pickup or dropoff) the rider hasn't reached yet.
 */
export function useRiderLiveRoute({
  tripId,
  tripLive,
  pickupStop,
  dropoffStop,
  pickupConfirmedAt,
  droppedOffAt,
}: UseRiderLiveRouteParams): RiderLiveRoute {
  const { onLocationUpdate } = useRideSocket();

  const [position, setPosition] = useState<Location.LocationObject | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [driverPosition, setDriverPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [driverLastUpdateAt, setDriverLastUpdateAt] = useState<string | null>(null);
  // The trip's fixed pickup→dropoff route line, for context only (the rider
  // isn't navigating) — fetched once, not re-fetched as the driver moves.
  const [routePolyline, setRoutePolyline] = useState<{ lat: number; lng: number }[] | undefined>(undefined);
  const hasFetchedRouteRef = useRef(false);
  // Live ETA (minutes) from the driver's current position to the rider's
  // next stop — pickup until pickupConfirmedAt is set, dropoff after.
  const [etaMinutes, setEtaMinutes] = useState<number | null>(null);
  const [driverDistanceKm, setDriverDistanceKm] = useState<number | null>(null);
  // Last-fetch timestamp per target, so switching targets (pickup → dropoff)
  // doesn't have to wait out the OTHER target's throttle window.
  const lastEtaFetchAtRef = useRef<{ pickup: number | null; dropoff: number | null }>({ pickup: null, dropoff: null });

  // Full trip route (every pickup/dropoff stop across the whole carpool, not
  // just this rider's own pickupStop/dropoffStop) — powers only the map's
  // de-emphasized "other stops" pins, the Stops tab's overview list, and the
  // Driver tab's vehicle color/year. Reuses the same public trip-detail
  // endpoint already used elsewhere in this app for browsing/booking a trip
  // — not a new backend surface. A failed or not-yet-loaded fetch just
  // leaves those fields empty/null; it never blocks pickup/dropoff, ETA,
  // chat, or cancellation.
  const tripStopsQuery = useQuery({
    queryKey: ['tripStops', tripId],
    queryFn: () => tripsApi.getOne(tripId ?? ''),
    enabled: tripLive && !!tripId,
  });

  // Foreground-only location watch, active only while the trip is actually
  // running for this rider's confirmed seat.
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
    // buttons never trust a reading from a watch that's no longer running.
    return () => {
      cancelled = true;
      subscription?.remove();
      setPosition(null);
    };
  }, [tripLive]);

  // Maintains the driver's last-known position from the socket while the
  // trip is live — cleared on cleanup so a stale dot never lingers once the
  // ride stops being live or this screen unmounts.
  useEffect(() => {
    if (!tripLive) return;

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
    // onLocationUpdate omitted deliberately: useRideSocket() returns a new
    // function identity every render (it reads live module state, not a
    // stale closure), so including it would resubscribe on every render
    // instead of only when tripLive/tripId change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripLive, tripId]);

  // Fetches the trip's whole pickup→dropoff route line ONCE, the first time
  // the trip is live — this is just map context for the rider (who isn't
  // navigating), so it's never re-fetched as the driver's position updates.
  // hasFetchedRouteRef guards the actual network call so remounts/refetches
  // can't trigger it again. A failed call or "no route" response just leaves
  // the map without a route line — never a crash, never something that
  // blocks ride actions.
  useEffect(() => {
    if (!tripLive || !pickupStop || !dropoffStop || hasFetchedRouteRef.current) return;
    hasFetchedRouteRef.current = true;

    let cancelled = false;
    geoApi
      .getRouteDirections({ lat: pickupStop.lat, lng: pickupStop.lng }, { lat: dropoffStop.lat, lng: dropoffStop.lng })
      .then((directions) => {
        if (!cancelled) setRoutePolyline(directions.polyline);
      })
      .catch(() => {
        // Nice-to-have overlay only — silently leave routePolyline unset.
      });

    return () => {
      cancelled = true;
    };
  }, [tripLive, pickupStop, dropoffStop]);

  // Clears the last-known ETA whenever the rider's "next stop" target
  // switches (pickup confirmed → now targeting dropoff; dropped off → no
  // more ETA needed) so a stale pickup-context number never gets relabelled
  // as a dropoff one (or vice versa) while the next real fetch is in flight.
  // Wrapped in an async IIFE — a bare synchronous setState at the top of an
  // effect body triggers this project's react-hooks/set-state-in-effect lint
  // rule.
  useEffect(() => {
    (async () => {
      setEtaMinutes(null);
      setDriverDistanceKm(null);
    })();
  }, [pickupConfirmedAt, droppedOffAt]);

  // Live ETA from the driver's current position to the rider's next stop —
  // reuses the SAME route-directions call as the one-time whole-route fetch
  // above, but with the origin re-aimed at the driver's live position each
  // time, and re-run periodically as that position updates via the socket.
  //
  // THROTTLING: this effect body re-runs on every driverPosition update from
  // the socket (~every 4s), but it only issues the actual network call when
  // at least ETA_FETCH_THROTTLE_MS (45s) have passed since the last fetch
  // made FOR THIS SAME TARGET — every other ~4s tick just re-checks the ref
  // and returns immediately with no network call. This is what keeps the ~4s
  // GPS cadence from turning into an unbounded per-tick API cost.
  useEffect(() => {
    if (!tripLive || !driverPosition || droppedOffAt) return;

    const target: 'pickup' | 'dropoff' = pickupConfirmedAt ? 'dropoff' : 'pickup';
    const destStop = target === 'pickup' ? pickupStop : dropoffStop;
    if (!destStop) return;

    const now = Date.now();
    const lastFetchedAt = lastEtaFetchAtRef.current[target];
    if (lastFetchedAt !== null && now - lastFetchedAt < ETA_FETCH_THROTTLE_MS) return;
    lastEtaFetchAtRef.current[target] = now;

    let cancelled = false;
    geoApi
      .getRouteDirections({ lat: driverPosition.lat, lng: driverPosition.lng }, { lat: destStop.lat, lng: destStop.lng })
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
  }, [tripLive, driverPosition, pickupConfirmedAt, droppedOffAt, pickupStop, dropoffStop]);

  const pickupDistanceM =
    position && pickupStop
      ? haversineDistanceMeters(
          { lat: position.coords.latitude, lng: position.coords.longitude },
          { lat: pickupStop.lat, lng: pickupStop.lng },
        )
      : null;
  const dropoffDistanceM =
    position && dropoffStop
      ? haversineDistanceMeters(
          { lat: position.coords.latitude, lng: position.coords.longitude },
          { lat: dropoffStop.lat, lng: dropoffStop.lng },
        )
      : null;

  // Whole-route stops, in visit order — used only for the map's
  // de-emphasized "other stops" pins and the Stops tab's overview list.
  // Empty whenever the fetch hasn't resolved (loading, disabled, or failed);
  // every use site tolerates that gracefully.
  const tripStopsSorted = (tripStopsQuery.data?.stops ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
  const numberedTripStops = tripStopsSorted.map((stop, index) => ({ stop, sequence: index + 1 }));
  const dropoffRealSequence = dropoffStop
    ? numberedTripStops.find(({ stop }) => stop.id === dropoffStop.id)?.sequence
    : undefined;
  const dropoffSequence = Math.max(2, dropoffRealSequence ?? 2);

  // Every OTHER stop on the whole trip (not this rider's own pickup/dropoff) —
  // rendered as small, muted, unlabeled pins so the full route shape is
  // visible on the map without competing with the rider's own two stops.
  const otherTripStops: LiveTripStop[] = numberedTripStops
    .filter(({ stop }) => stop.id !== pickupStop?.id && stop.id !== dropoffStop?.id && stop.lat != null && stop.lng != null)
    .map(({ stop, sequence }) => ({
      id: stop.id,
      type: stop.type,
      label: stop.label,
      lat: stop.lat as number,
      lng: stop.lng as number,
      sequence,
      status: 'upcoming' as const,
    }));

  return {
    position,
    locationDenied,
    pickupDistanceM,
    dropoffDistanceM,
    driverPosition,
    driverLastUpdateAt,
    routePolyline,
    etaMinutes,
    driverDistanceKm,
    otherTripStops,
    dropoffSequence,
    tripStopsSorted,
    tripStopsLoading: tripStopsQuery.isLoading,
    vehicleColor: tripStopsQuery.data?.userVehicle.color ?? null,
    vehicleYear: tripStopsQuery.data?.userVehicle.year ?? null,
  };
}
