import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type LatLng, type MapMarker, type Region } from 'react-native-maps';

import { AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';

export interface LiveTripStop {
  id: string;
  type: 'PICKUP' | 'DROPOFF';
  label: string;
  lat: number;
  lng: number;
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

export function LiveTripMap({ stops, driverPosition, isConnected, lastUpdateAt, routePolyline }: LiveTripMapProps) {
  const { colors, spacing, radii } = useTheme();
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
    if (!driverPosition) return;
    // Harmless no-op animation the very first time (animates the
    // just-mounted marker to the position it already occupies) — every
    // update after that actually glides it.
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

        {stops.map((stop) => (
          <Marker
            key={stop.id}
            coordinate={{ latitude: stop.lat, longitude: stop.lng }}
            title={stop.label}
            // Marker.pinColor on Android only recognizes a small enumerated
            // set of names (it silently falls back to red for anything
            // else, e.g. an arbitrary hex) — 'green'/'red' are two of the
            // few guaranteed to render distinctly on both platforms.
            pinColor={stop.type === 'PICKUP' ? 'green' : 'red'}
            // Explicit and above the route line's zIndex={1} so the
            // polyline never draws over a stop marker.
            zIndex={5}
          />
        ))}

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
            <View style={[styles.driverDot, { backgroundColor: colors.primary, borderColor: colors.background }]} />
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
  banner: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
  },
});
