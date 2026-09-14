import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type LatLng, type MapMarker, type Region } from 'react-native-maps';

import { AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';
import type { ThemeColors } from '../../../theme';

export interface LiveTripStop {
  id: string;
  type: 'PICKUP' | 'DROPOFF';
  label: string;
  lat: number;
  lng: number;
  // Both optional and additive, for the driver's active-ride map only (design
  // spec section 3, "Map"). `sequence` is the stop's 1-based position in
  // route order; `status` is its visual state for the numbered pin below.
  // The rider screen (trip-request/[id].tsx) never passes either — when one
  // is missing for a stop, that stop renders exactly as it does today (a
  // plain built-in pinColor Marker, no number, no special sizing/tap
  // handling), so today's only caller is completely unaffected.
  sequence?: number;
  status?: 'reached' | 'selected' | 'next' | 'upcoming';
}

export interface LiveTripMapProps {
  stops: LiveTripStop[];
  driverPosition: { lat: number; lng: number } | null;
  isConnected: boolean;
  lastUpdateAt: string | null;
  // Optional route line (driver: next-stop leg; rider: whole trip route),
  // drawn under the stop/driver markers below. Additive — every existing
  // call site keeps working unchanged if it omits this prop entirely.
  routePolyline?: { lat: number; lng: number }[];
  // Additive. Fires with a stop's id when its Marker is tapped — only
  // meaningful for stops rendered as numbered pins (see `sequence`/`status`
  // above); a plain stop (neither field set) never calls this since it has
  // no onPress wired up, matching its unchanged look. Lets tapping a map pin
  // do the same thing as tapping that stop's card in the Stops tab list.
  onSelectStop?: (stopId: string) => void;
  // Additive, for the rider's active-ride map only (reference mockup's
  // driver-pin styling, pinDef['driver']). When provided, the driver marker
  // renders as a labeled circular pin showing this text (e.g. "D") instead
  // of the current plain colored dot — same animateMarkerToCoordinate
  // movement and same mount-timing crash-guard, only the marker's child view
  // looks different. The driver screen's own map never passes this (its
  // driver marker is the viewer's own position, which needs no "you are
  // here" label), so it keeps rendering the plain dot exactly as before.
  driverLabel?: string;
}

// --- Numbered stop pins (design spec section 3, "Map") ------------------
// Sizes/colors per the reference mockup's pin-styling logic, which branches
// only on "is this stop reached" and "is this stop the selected one" — a
// stop marked 'next' that isn't also selected renders with the same visual
// treatment as 'upcoming' (see pinStyleFor below).
const SELECTED_PIN_SIZE = 30;
const REGULAR_PIN_SIZE = 24; // reached, next (non-selected) and upcoming
// Not in the shared theme token file — legitimate new values specific to
// this design's "reached" pin treatment.
const REACHED_PIN_FILL = '#FFDDE2';
const REACHED_PIN_TEXT = '#C2203C';
// Gap between the selected pin's dot and its label chip below, and the
// chip's approximate rendered height (13px/600 text + 3px vertical padding
// each side) — used only to keep the DOT itself (not the chip) anchored at
// the stop's actual coordinate; see SELECTED_PIN_ANCHOR.
const PIN_LABEL_GAP = 4;
const PIN_LABEL_HEIGHT_ESTIMATE = 24;

// Driver pin (rider's active-ride map only — see the `driverLabel` prop
// doc). Hardcoded per the reference mockup's driver-pin styling — not in
// the shared theme token file, matching the convention already used for
// REACHED_PIN_FILL/REACHED_PIN_TEXT above.
const DRIVER_PIN_SIZE = 30;
const DRIVER_PIN_FILL = '#1A0F14';

const DOT_ONLY_ANCHOR = { x: 0.5, y: 0.5 };
const SELECTED_PIN_ANCHOR = {
  x: 0.5,
  y: SELECTED_PIN_SIZE / 2 / (SELECTED_PIN_SIZE + PIN_LABEL_GAP + PIN_LABEL_HEIGHT_ESTIMATE),
};

function pinStyleFor(status: NonNullable<LiveTripStop['status']>, colors: ThemeColors) {
  if (status === 'reached') {
    return { size: REGULAR_PIN_SIZE, fill: REACHED_PIN_FILL, text: REACHED_PIN_TEXT, borderColor: undefined as string | undefined };
  }
  if (status === 'selected') {
    return { size: SELECTED_PIN_SIZE, fill: colors.primary, text: colors.primaryText, borderColor: undefined as string | undefined };
  }
  // 'next' and 'upcoming' render identically — see the block comment above.
  return { size: REGULAR_PIN_SIZE, fill: colors.surface, text: colors.text, borderColor: colors.borderStrong as string | undefined };
}

// Pakistan's rough centroid — same fallback used by LocationMapSheet — shown
// only until fitToCoordinates runs (or when there are no stops to fit to).
const DEFAULT_REGION: Region = { latitude: 30.3753, longitude: 69.3451, latitudeDelta: 12, longitudeDelta: 12 };
const FIT_EDGE_PADDING = { top: 80, right: 80, bottom: 80, left: 80 };
// Matches the expected location.update ping cadence from the driver's GPS watch.
const DRIVER_MARKER_ANIMATION_MS = 4000;

function regionFromStops(stops: LiveTripStop[]): Region | undefined {
  if (stops.length === 0) return undefined;

  const lats = stops.map((s) => s.lat);
  const lngs = stops.map((s) => s.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    // Padded so a single stop (or two very close ones) doesn't zoom in to
    // nothing; fitToCoordinates takes over for the real fit once the map is
    // ready, this is only the region shown before that.
    latitudeDelta: Math.max((maxLat - minLat) * 1.6, 0.02),
    longitudeDelta: Math.max((maxLng - minLng) * 1.6, 0.02),
  };
}

export function LiveTripMap({ stops, driverPosition, isConnected, lastUpdateAt, routePolyline, onSelectStop, driverLabel }: LiveTripMapProps) {
  const { colors, spacing, radii, shadows } = useTheme();
  const mapRef = useRef<MapView>(null);
  const driverMarkerRef = useRef<MapMarker>(null);
  const mapReadyRef = useRef(false);

  // The Marker's `coordinate` prop is set ONCE, to the first position we
  // ever see — every position after that moves the marker via the
  // imperative `animateMarkerToCoordinate` instead of re-setting the prop,
  // since changing `coordinate` on a live marker snaps it instead of
  // gliding. This is react-native-maps' established technique for smooth
  // live-tracking markers (deliberately not Animated.ValueXY).
  const [initialDriverCoordinate, setInitialDriverCoordinate] = useState<LatLng | null>(null);
  // True once the driver Marker has survived at least one extra effect pass
  // since it was (re)created. Guards against a real, reproduced Android
  // crash: calling the native animateMarkerToCoordinate on a Marker in the
  // SAME commit it was just mounted in throws a NullPointerException inside
  // react-native-maps' native interpolate() — the native view's internal
  // position isn't initialized yet at that point, despite the `coordinate`
  // prop already being set. Reset to false whenever the marker unmounts (see
  // the effect below) so a later remount (e.g. after a connection drop) is
  // treated as fresh too, not just the very first mount ever.
  const hasMountedDriverMarkerRef = useRef(false);

  // Memoized on `stops` identity so the effect below only re-fits when the
  // set of stops actually changes, not on every unrelated re-render (e.g. a
  // driverPosition update).
  const fitToStops = useCallback(() => {
    if (!mapReadyRef.current || stops.length === 0) return;
    mapRef.current?.fitToCoordinates(
      stops.map((s) => ({ latitude: s.lat, longitude: s.lng })),
      { edgePadding: FIT_EDGE_PADDING, animated: true },
    );
  }, [stops]);

  const handleMapReady = () => {
    mapReadyRef.current = true;
    fitToStops();
  };

  useEffect(() => {
    fitToStops();
  }, [fitToStops]);

  // First fix ever received: adjust state during render (React's documented
  // pattern for deriving state from a prop change — see "storing information
  // from previous renders") so the Marker mounts already at the right spot.
  // Deliberately not inside an effect: that would add an extra render+commit
  // round trip just to set state we already know synchronously.
  if (driverPosition && !initialDriverCoordinate) {
    setInitialDriverCoordinate({ latitude: driverPosition.lat, longitude: driverPosition.lng });
  }

  useEffect(() => {
    if (!driverPosition) {
      // Marker is about to unmount (see the JSX condition below) — treat
      // a later remount as fresh too, not a "subsequent update" (note:
      // initialDriverCoordinate itself deliberately stays set once assigned
      // — see its own declaration above — so a remount reuses that same
      // cached first-ever position rather than snapping to a new one; that's
      // an existing, separate, non-crashing behavior this fix doesn't change).
      hasMountedDriverMarkerRef.current = false;
      return;
    }
    if (!hasMountedDriverMarkerRef.current) {
      // Skip animating on the same commit the marker was just created in —
      // its `coordinate` prop already places it here; see the ref's own
      // comment for why calling the native animate method right now crashes.
      hasMountedDriverMarkerRef.current = true;
      return;
    }
    driverMarkerRef.current?.animateMarkerToCoordinate(
      { latitude: driverPosition.lat, longitude: driverPosition.lng },
      DRIVER_MARKER_ANIMATION_MS,
    );
  }, [driverPosition]);

  const bannerText = !isConnected
    ? lastUpdateAt
      ? `Connection lost — last known location as of ${new Date(lastUpdateAt).toLocaleTimeString()}`
      : 'Connection lost — no location yet'
    : null;

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        initialRegion={regionFromStops(stops) ?? DEFAULT_REGION}
        onMapReady={handleMapReady}
      >
        {routePolyline && routePolyline.length > 1 ? (
          <Polyline
            coordinates={routePolyline.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
            strokeColor={`${colors.primary}99`}
            strokeWidth={4}
            zIndex={1}
          />
        ) : null}

        {stops.map((stop) => {
          // Plain pin — unchanged from before this stage, and still the only
          // path the rider screen ever exercises (it never sets sequence or
          // status).
          if (stop.sequence == null || stop.status == null) {
            return (
              <Marker
                key={stop.id}
                coordinate={{ latitude: stop.lat, longitude: stop.lng }}
                title={stop.label}
                // Marker.pinColor on Android only recognizes a small
                // enumerated set of names (it silently falls back to red for
                // anything else, e.g. an arbitrary hex) — 'green'/'red' are
                // two of the few guaranteed to render distinctly on both
                // platforms.
                pinColor={stop.type === 'PICKUP' ? 'green' : 'red'}
                // Explicit and above the route line's zIndex={1} so the
                // polyline never draws over a stop marker.
                zIndex={5}
              />
            );
          }

          // Numbered pin (driver's active-ride map). Only this custom-view
          // path ever gets a tap handler — a plain pin above has none.
          const pin = pinStyleFor(stop.status, colors);
          const handlePress = onSelectStop ? () => onSelectStop(stop.id) : undefined;

          if (stop.status !== 'selected') {
            return (
              <Marker
                key={stop.id}
                coordinate={{ latitude: stop.lat, longitude: stop.lng }}
                anchor={DOT_ONLY_ANCHOR}
                zIndex={5}
                onPress={handlePress}
              >
                <View
                  style={[
                    styles.pinDot,
                    { width: pin.size, height: pin.size, borderRadius: pin.size / 2, backgroundColor: pin.fill },
                    pin.borderColor ? { borderWidth: 1, borderColor: pin.borderColor } : null,
                  ]}
                >
                  <AppText variant="label" color={pin.text}>
                    {stop.sequence}
                  </AppText>
                </View>
              </Marker>
            );
          }

          // Selected — the only state that also shows a label chip below
          // the dot (mockup's showLabel logic gates the chip on selection
          // alone, no other pin state ever shows one).
          const kindLabel = stop.type === 'PICKUP' ? 'Pickup' : 'Dropoff';

          return (
            <Marker
              key={stop.id}
              coordinate={{ latitude: stop.lat, longitude: stop.lng }}
              anchor={SELECTED_PIN_ANCHOR}
              // Above the other stop pins so its label chip never sits
              // under a neighboring pin.
              zIndex={6}
              onPress={handlePress}
            >
              <View style={styles.pinWithLabelWrap}>
                <View
                  style={[
                    styles.pinDot,
                    { width: pin.size, height: pin.size, borderRadius: pin.size / 2, backgroundColor: pin.fill },
                  ]}
                >
                  <AppText variant="label" color={pin.text}>
                    {stop.sequence}
                  </AppText>
                </View>
                <View
                  style={[
                    styles.pinLabelChip,
                    { marginTop: PIN_LABEL_GAP, backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.chip },
                    shadows.xs,
                  ]}
                >
                  <AppText variant="label" numberOfLines={1}>
                    {kindLabel} · {stop.label}
                  </AppText>
                </View>
              </View>
            </Marker>
          );
        })}

        {driverPosition && initialDriverCoordinate ? (
          <Marker
            ref={driverMarkerRef}
            coordinate={initialDriverCoordinate}
            title="Driver"
            anchor={{ x: 0.5, y: 0.5 }}
            zIndex={10}
            // The custom child view below never changes, so tracking view
            // changes only costs perf here — the smooth motion comes from
            // animateMarkerToCoordinate, not from re-rendering this view.
            tracksViewChanges={false}
          >
            {driverLabel ? (
              <View
                style={[
                  styles.pinDot,
                  { width: DRIVER_PIN_SIZE, height: DRIVER_PIN_SIZE, borderRadius: DRIVER_PIN_SIZE / 2, backgroundColor: DRIVER_PIN_FILL },
                ]}
              >
                <AppText variant="label" color={colors.primaryText}>
                  {driverLabel}
                </AppText>
              </View>
            ) : (
              <View style={[styles.driverDot, { backgroundColor: colors.primary, borderColor: colors.background }]} />
            )}
          </Marker>
        ) : null}
      </MapView>

      {bannerText ? (
        <View style={[styles.banner, { backgroundColor: colors.surface, borderRadius: radii.card, padding: spacing.sm }]}>
          <AppText variant="caption" color={colors.danger}>
            {bannerText}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  driverDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
  },
  pinDot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinWithLabelWrap: {
    alignItems: 'center',
  },
  pinLabelChip: {
    borderWidth: 1,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  banner: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
  },
});
