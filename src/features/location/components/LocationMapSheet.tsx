import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, View } from 'react-native';
import MapView, { PROVIDER_GOOGLE, type Details, type LatLng, type Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';

import { AppButton, AppSheet, AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';
import { useCurrentLocation } from '../../../hooks/useCurrentLocation';
import { geoApi } from '../../../api/geo.api';
import { normalizeApiError } from '../../../api/errors';
import { isSameSpot, zoomRegion } from '../mapRegion';
import { MapPlaceSearch } from './MapPlaceSearch';
import { CenterPin, MapControls } from './MapPickerControls';

interface LocationMapSheetProps {
  visible: boolean;
  /** Defaults to "Choose on map". */
  title?: string;
  onClose: () => void;
  onConfirm: (result: { lat: number; lng: number; address: string }) => void;
  initialLat?: number;
  initialLng?: number;
  /** The field's current text — reused as the address if the pin is confirmed without moving. */
  initialAddress?: string;
  /** CLDR region codes to bias/restrict the search box's results, e.g. ['PK', 'AE', 'SA']. */
  regionCodes?: string[];
}

// Pakistan's rough centroid — same default as web's picker, just an initial
// view before any location is picked.
const DEFAULT_REGION: Region = { latitude: 30.3753, longitude: 69.3451, latitudeDelta: 12, longitudeDelta: 12 };
const PICKED_DELTA = 0.01;
const LOCATE_DELTA = 0.005;
// Wider than this (roughly neighbourhood level) the centre pin is too coarse
// to stand for a pickup/drop-off spot, so confirming is disabled and no
// reverse geocode is spent on it.
const MAX_CONFIRM_DELTA = 0.1;
const ZOOM_DURATION_MS = 250;
const GEOCODE_DEBOUNCE_MS = 400;
// Only for choosing where the map opens — an older fix still puts the user in
// the right city, which is all that matters before they search or pan.
const LAST_KNOWN_MAX_AGE_MS = 15 * 60_000;

export function LocationMapSheet({ visible, onClose, title = 'Choose on map', ...pickerProps }: LocationMapSheetProps) {
  return (
    <AppSheet visible={visible} onClose={onClose} title={title} height="90%">
      {/* Modal unmounts its children while hidden, so the picker starts fresh
          from the field's current value every time the sheet opens. */}
      <MapPicker {...pickerProps} />
    </AppSheet>
  );
}

type MapPickerProps = Omit<LocationMapSheetProps, 'visible' | 'onClose' | 'title'>;

// Uber/Careem-style picker: the pin stays fixed at the centre and the user
// moves the map under it (or jumps there via search / current location).
function MapPicker({ onConfirm, initialLat, initialLng, initialAddress, regionCodes }: MapPickerProps) {
  const { colors, spacing, radii } = useTheme();
  const mapRef = useRef<MapView>(null);
  const { loading: locating, requestLocation } = useCurrentLocation();

  const initialSpot =
    initialLat !== undefined && initialLng !== undefined ? { latitude: initialLat, longitude: initialLng } : undefined;
  const [initialRegion] = useState<Region>(() =>
    initialSpot ? { ...initialSpot, latitudeDelta: PICKED_DELTA, longitudeDelta: PICKED_DELTA } : DEFAULT_REGION,
  );

  const initialKnown =
    initialSpot && initialAddress?.trim() ? { coordinate: initialSpot, address: initialAddress.trim() } : null;

  // Last settled region — or, mid-zoom, the region being zoomed to, so rapid
  // +/− taps compound instead of each starting from a stale region.
  const regionRef = useRef<Region>(initialRegion);
  // An address already known for a spot (the field's own text, or a search
  // result's) — reused instead of reverse geocoding that spot again.
  const knownAddressRef = useRef<{ coordinate: LatLng; address: string } | null>(initialKnown);
  // Set once the user moves the map in any way, so the opening jump to their
  // last known position never yanks the map away from them.
  const interactedRef = useRef(false);
  const geocodeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const geocodeSeqRef = useRef(0);

  const [center, setCenter] = useState<LatLng>({ latitude: initialRegion.latitude, longitude: initialRegion.longitude });
  const [zoomedIn, setZoomedIn] = useState(initialRegion.latitudeDelta <= MAX_CONFIRM_DELTA);
  const [moving, setMoving] = useState(false);
  // undefined = still looking it up; '' = the lookup failed (the spot itself
  // is still fine to confirm, it just won't come with a label).
  const [address, setAddress] = useState<string | undefined>(initialKnown?.address);
  const [showsUserLocation, setShowsUserLocation] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => clearTimeout(geocodeTimerRef.current), []);

  const cancelLookup = () => {
    clearTimeout(geocodeTimerRef.current);
    geocodeSeqRef.current += 1;
  };

  const lookupAddress = (coordinate: LatLng) => {
    cancelLookup();
    const seq = geocodeSeqRef.current;
    setAddress(undefined);
    geocodeTimerRef.current = setTimeout(async () => {
      try {
        const result = await geoApi.reverseGeocode(coordinate.latitude, coordinate.longitude);
        if (seq !== geocodeSeqRef.current) return;
        const label = result.formattedAddress || result.label;
        knownAddressRef.current = { coordinate, address: label };
        setAddress(label);
      } catch (err) {
        if (seq !== geocodeSeqRef.current) return;
        setAddress('');
        console.warn('[LocationMapSheet] reverse geocode failed:', normalizeApiError(err).message);
      }
    }, GEOCODE_DEBOUNCE_MS);
  };

  const animateTo = (coordinate: LatLng, delta: number) => {
    const region = { ...coordinate, latitudeDelta: delta, longitudeDelta: delta };
    regionRef.current = region;
    mapRef.current?.animateToRegion(region, 400);
  };

  const handleMapReady = async () => {
    if (zoomedIn && address === undefined) lookupAddress(center);

    // Never prompts — only uses location access the user already granted, to
    // show their blue dot and (with no spot picked yet) open on their area
    // instead of the whole country.
    try {
      const { granted } = await Location.getForegroundPermissionsAsync();
      if (!granted) return;
      setShowsUserLocation(true);
      if (initialSpot) return;
      const lastKnown = await Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS });
      if (lastKnown && !interactedRef.current) {
        animateTo({ latitude: lastKnown.coords.latitude, longitude: lastKnown.coords.longitude }, PICKED_DELTA);
      }
    } catch (err) {
      console.warn('[LocationMapSheet] last known position unavailable:', err);
    }
  };

  // Fires continuously while the map moves, whether dragged or animated.
  const handleRegionChange = (_region: Region, details?: Details) => {
    if (details?.isGesture) {
      interactedRef.current = true;
      Keyboard.dismiss();
    }
    if (moving) return;
    setMoving(true);
    // Whatever was being looked up is for a spot the pin has already left.
    cancelLookup();
  };

  const handleRegionChangeComplete = (region: Region) => {
    regionRef.current = region;
    const next = { latitude: region.latitude, longitude: region.longitude };
    const closeEnough = region.latitudeDelta <= MAX_CONFIRM_DELTA;
    setMoving(false);
    setCenter(next);
    setZoomedIn(closeEnough);

    if (!closeEnough) {
      cancelLookup();
      setAddress(undefined);
      return;
    }
    const known = knownAddressRef.current;
    if (known && isSameSpot(known.coordinate, next)) {
      setAddress(known.address);
      return;
    }
    lookupAddress(next);
  };

  // Zooms around the centre, so the picked spot stays under the pin.
  const zoomBy = (factor: number) => {
    interactedRef.current = true;
    const next = zoomRegion(regionRef.current, factor);
    regionRef.current = next;
    mapRef.current?.animateToRegion(next, ZOOM_DURATION_MS);
  };

  const handleLocate = async () => {
    interactedRef.current = true;
    setError(null);
    const coords = await requestLocation();
    if (!coords) {
      setError("Couldn't get your location — search for the place or move the map instead.");
      return;
    }
    setShowsUserLocation(true);
    animateTo({ latitude: coords.lat, longitude: coords.lng }, LOCATE_DELTA);
  };

  const handlePlaceSelected = (place: { latitude: number; longitude: number; address: string }) => {
    interactedRef.current = true;
    setError(null);
    const coordinate = { latitude: place.latitude, longitude: place.longitude };
    knownAddressRef.current = { coordinate, address: place.address };
    animateTo(coordinate, PICKED_DELTA);
  };

  const canConfirm = zoomedIn && !moving;

  const handleConfirm = async () => {
    if (!canConfirm) return;
    const { latitude: lat, longitude: lng } = center;
    if (address !== undefined) {
      onConfirm({ lat, lng, address });
      return;
    }

    // Lookup still pending — take it over rather than confirm without a label.
    cancelLookup();
    setConfirming(true);
    try {
      const result = await geoApi.reverseGeocode(lat, lng);
      onConfirm({ lat, lng, address: result.formattedAddress || result.label });
    } catch (err) {
      // Coordinates are still good even if the label lookup fails — don't
      // block confirming just because reverse geocoding hiccuped.
      onConfirm({ lat, lng, address: '' });
      console.warn('[LocationMapSheet] reverse geocode failed:', normalizeApiError(err).message);
    } finally {
      setConfirming(false);
    }
  };

  const findingAddress = zoomedIn && (moving || address === undefined);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1, borderRadius: radii.card, overflow: 'hidden', marginBottom: spacing.md }}>
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={{ flex: 1 }}
          initialRegion={initialRegion}
          showsUserLocation={showsUserLocation}
          showsMyLocationButton={false}
          toolbarEnabled={false}
          // A flat, north-up map keeps the centre pin unambiguous and keeps
          // the compass from appearing under the search box.
          rotateEnabled={false}
          pitchEnabled={false}
          onMapReady={handleMapReady}
          onPress={() => Keyboard.dismiss()}
          onRegionChange={handleRegionChange}
          onRegionChangeComplete={handleRegionChangeComplete}
        />
        <CenterPin lifted={moving} />
        <MapControls
          locating={locating}
          onLocate={handleLocate}
          onZoomIn={() => zoomBy(0.5)}
          onZoomOut={() => zoomBy(2)}
        />
        <MapPlaceSearch regionCodes={regionCodes} onSelect={handlePlaceSelected} onError={setError} />
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md, minHeight: 40 }}>
        <Ionicons
          name="location"
          size={20}
          color={zoomedIn ? colors.primary : colors.textFaint}
          style={{ marginTop: 1 }}
        />
        <View style={{ flex: 1 }}>
          {!zoomedIn ? (
            <AppText muted variant="caption">
              Search for a place, or zoom in and move the map so the pin sits on the exact spot.
            </AppText>
          ) : findingAddress ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <ActivityIndicator size="small" color={colors.textMuted} />
              <AppText muted variant="caption">
                Finding address…
              </AppText>
            </View>
          ) : address ? (
            <AppText numberOfLines={2}>{address}</AppText>
          ) : (
            <AppText muted variant="caption">
              Address unavailable — you can still confirm this spot.
            </AppText>
          )}
        </View>
      </View>

      {error ? (
        <AppText color={colors.danger} variant="caption" style={{ marginBottom: spacing.sm }}>
          {error}
        </AppText>
      ) : null}

      <AppButton title="Confirm location" disabled={!canConfirm} loading={confirming} onPress={handleConfirm} />
    </View>
  );
}
