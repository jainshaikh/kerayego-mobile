import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { useQuery } from '@tanstack/react-query';

import { geoApi } from '../../../api/geo.api';
import { tripsApi } from '../../../api/trips.api';
import type { TripInquiryStopRef } from '../../../api/trip-inquiries.api';
import { useRideSocket } from '../../liveRide/socket';
import { haversineDistanceMeters } from '../../liveRide/geo';
import type { LiveTripStop } from '../../liveRide/components/LiveTripMap';
import { hasCoordinates, orderRouteStops, routeSequence, type RouteStop } from './routeStops';

// Live ETA-to-stop fetches are throttled to at most once per this interval,
// regardless of how often the driver's position updates via the socket
// (~every 4s) — reuses the same route-directions endpoint as the one-time
// whole-route fetch below, just aimed at the driver's current (moving)
// position instead of the fixed pickup point.
const ETA_FETCH_THROTTLE_MS = 45_000;

// This rider's own pickup/dropoff stop, as carried on TripInquiry — shared by
// this hook and the rider live-view components below it so they can't drift
// apart. lat/lng are null for a stop typed as free text: every distance,
// directions call and map pin below checks hasCoordinates first.
export type RiderStop = TripInquiryStopRef;

interface UseRiderLiveRouteParams {
  tripId: string | undefined;
  // The ride is live for THIS rider — the ride lock (see isRideLocked): seat
  // accepted, trip running, not yet dropped off or marked a no-show. Every
  // GPS watch, socket subscription and ETA fetch here stops as soon as it
  // turns false.
  rideLive: boolean;
  pickupStop: RiderStop | null;
  dropoffStop: RiderStop | null;
  pickupConfirmedAt: string | null;
  // The trip's whole route, carried on the rider's own request by a newer
  // backend; undefined from an older one, which falls back to the public
  // trip fetch below.
  routeStops: RouteStop[] | undefined;
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
  // pickup/dropoff (only those with coordinates) — the caller combines these
  // with the rider's own two stops to build the map's full pin set (kept
  // separate here since those two pins' look depends on the ride phase).
  otherTripStops: LiveTripStop[];
  // The rider's own stops' 1-based positions in route order.
  pickupSequence: number;
  dropoffSequence: number;
  // The whole route in visit order (pickups, then drop-offs).
  tripStops: RouteStop[];
  tripStopsLoading: boolean;
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
  rideLive,
  pickupStop,
  dropoffStop,
  pickupConfirmedAt,
  routeStops,
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

  // Older-backend fallback only: the whole route from the public trip
  // detail endpoint. That endpoint 404s once a trip is IN_PROGRESS, so on
  // such a backend this usually comes back empty — the Stops tab says so,
  // and nothing else depends on it. A newer backend carries the route on
  // the rider's own request (routeStops), which needs no second call.
  const fallbackStopsQuery = useQuery({
    queryKey: ['tripStops', tripId],
    queryFn: () => tripsApi.getOne(tripId ?? ''),
    enabled: rideLive && !!tripId && routeStops === undefined,
  });

  // Foreground-only location watch, active only while the ride is live for
  // this rider.
  useEffect(() => {
    if (!rideLive) return;

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

    // Clears any last-known fix once the ride stops being live (dropped off,
    // marked a no-show, seat cancelled, trip ended, or this screen unmounts)
    // — the geofence-gated buttons never trust a reading from a watch that's
    // no longer running.
    return () => {
      cancelled = true;
      subscription?.remove();
      setPosition(null);
    };
  }, [rideLive]);

  // Maintains the driver's last-known position from the socket while the
  // ride is live — cleared on cleanup so a stale dot never lingers once the
  // ride stops being live or this screen unmounts.
  useEffect(() => {
    if (!rideLive) return;

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
    // onLocationUpdate is a stable module-level function (socket.ts), so in
    // practice this re-runs only when rideLive/tripId change.
  }, [rideLive, tripId, onLocationUpdate]);

  // Fetches the trip's whole pickup→dropoff route line ONCE, the first time
  // the ride is live — this is just map context for the rider (who isn't
  // navigating), so it's never re-fetched as the driver's position updates.
  // hasFetchedRouteRef guards the actual network call so remounts/refetches
  // can't trigger it again. Needs both stops' coordinates; a failed call or
  // "no route" response just leaves the map without a route line — never a
  // crash, never something that blocks ride actions.
  useEffect(() => {
    if (!rideLive || !hasCoordinates(pickupStop) || !hasCoordinates(dropoffStop) || hasFetchedRouteRef.current) return;
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
  }, [rideLive, pickupStop, dropoffStop]);

  // Clears the last-known ETA whenever the rider's "next stop" target
  // switches (pickup confirmed → now targeting dropoff) or the ride stops
  // being live, so a stale pickup-context number never gets relabelled as a
  // dropoff one (or survives into a later live stretch) while the next real
  // fetch is in flight. Wrapped in an async IIFE — a bare synchronous
  // setState at the top of an effect body triggers this project's
  // react-hooks/set-state-in-effect lint rule.
  useEffect(() => {
    (async () => {
      setEtaMinutes(null);
      setDriverDistanceKm(null);
    })();
  }, [pickupConfirmedAt, rideLive]);

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
    if (!rideLive || !driverPosition) return;

    const target: 'pickup' | 'dropoff' = pickupConfirmedAt ? 'dropoff' : 'pickup';
    const destStop = target === 'pickup' ? pickupStop : dropoffStop;
    if (!hasCoordinates(destStop)) return;

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
  }, [rideLive, driverPosition, pickupConfirmedAt, pickupStop, dropoffStop]);

  const here = position ? { lat: position.coords.latitude, lng: position.coords.longitude } : null;
  const pickupDistanceM =
    here && hasCoordinates(pickupStop) ? haversineDistanceMeters(here, { lat: pickupStop.lat, lng: pickupStop.lng }) : null;
  const dropoffDistanceM =
    here && hasCoordinates(dropoffStop)
      ? haversineDistanceMeters(here, { lat: dropoffStop.lat, lng: dropoffStop.lng })
      : null;

  // Whole-route stops, in visit order — the map's de-emphasized "other
  // stops" pins, the Stops tab's overview list and the rider's own pins'
  // numbers. Empty whenever neither source has them (a legacy trip, or the
  // fallback fetch loading/failed); every use site tolerates that.
  const tripStops = orderRouteStops<RouteStop>(routeStops ?? fallbackStopsQuery.data?.stops ?? []);
  const pickupSequence = routeSequence(tripStops, pickupStop?.id) ?? 1;
  const dropoffSequence = Math.max(2, routeSequence(tripStops, dropoffStop?.id) ?? 2);

  // Every OTHER stop on the whole trip (not this rider's own pickup/dropoff) —
  // rendered as small, muted, unlabeled pins so the full route shape is
  // visible on the map without competing with the rider's own two stops.
  const otherTripStops: LiveTripStop[] = [];
  tripStops.forEach((stop, index) => {
    if (stop.id === pickupStop?.id || stop.id === dropoffStop?.id || !hasCoordinates(stop)) return;
    otherTripStops.push({
      id: stop.id,
      type: stop.type,
      label: stop.label,
      lat: stop.lat,
      lng: stop.lng,
      sequence: index + 1,
      status: stop.arrivedAt ? 'reached' : 'upcoming',
    });
  });

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
    pickupSequence,
    dropoffSequence,
    tripStops,
    tripStopsLoading: routeStops === undefined && fallbackStopsQuery.isLoading,
  };
}
