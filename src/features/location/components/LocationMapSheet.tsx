import { useRef, useState } from 'react';
import { View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, type LatLng, type MapPressEvent, type MarkerDragStartEndEvent } from 'react-native-maps';

import { AppButton, AppSheet, AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';
import { useCurrentLocation } from '../../../hooks/useCurrentLocation';
import { geoApi } from '../../../api/geo.api';
import { normalizeApiError } from '../../../api/errors';

interface LocationMapSheetProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (result: { lat: number; lng: number; address: string }) => void;
  initialLat?: number;
  initialLng?: number;
}

// Pakistan's rough centroid — same default as web's picker, just an initial
// view before any location is picked.
const DEFAULT_REGION = { latitude: 30.3753, longitude: 69.3451, latitudeDelta: 12, longitudeDelta: 12 };
const PICKED_DELTA = 0.01;

export function LocationMapSheet({ visible, onClose, onConfirm, initialLat, initialLng }: LocationMapSheetProps) {
  const { colors, spacing, radii } = useTheme();
  const mapRef = useRef<MapView>(null);
  const { loading: locating, requestLocation } = useCurrentLocation();
  const [pin, setPin] = useState<LatLng | undefined>(
    initialLat !== undefined && initialLng !== undefined ? { latitude: initialLat, longitude: initialLng } : undefined,
  );
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const animateTo = (coordinate: LatLng) => {
    mapRef.current?.animateToRegion({ ...coordinate, latitudeDelta: PICKED_DELTA, longitudeDelta: PICKED_DELTA }, 400);
  };

  const handleMapPress = (e: MapPressEvent) => {
    const coordinate = e.nativeEvent.coordinate;
    setPin(coordinate);
    animateTo(coordinate);
  };

  const handleMarkerDragEnd = (e: MarkerDragStartEndEvent) => {
    setPin(e.nativeEvent.coordinate);
  };

  const handleUseCurrentLocation = async () => {
    setError(null);
    const coords = await requestLocation();
    if (!coords) {
      setError("Couldn't get your location — you can still drop a pin manually.");
      return;
    }
    const coordinate = { latitude: coords.lat, longitude: coords.lng };
    setPin(coordinate);
    animateTo(coordinate);
  };

  const handleConfirm = async () => {
    if (!pin) return;
    setConfirming(true);
    setError(null);
    try {
      const result = await geoApi.reverseGeocode(pin.latitude, pin.longitude);
      onConfirm({ lat: pin.latitude, lng: pin.longitude, address: result.formattedAddress || result.label });
    } catch (err) {
      // Coordinates are still good even if the label lookup fails — don't
      // block confirming just because reverse geocoding hiccuped.
      onConfirm({ lat: pin.latitude, lng: pin.longitude, address: '' });
      console.warn('[LocationMapSheet] reverse geocode failed:', normalizeApiError(err).message);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <AppSheet visible={visible} onClose={onClose} title="Choose on map" height="75%">
      <AppText muted variant="caption" style={{ marginBottom: spacing.sm }}>
        {pin ? 'Drag the pin or tap the map to fine-tune the spot.' : 'Tap the map to drop a pin, or use your current location.'}
      </AppText>

      <View style={{ flex: 1, borderRadius: radii.card, overflow: 'hidden', marginBottom: spacing.sm }}>
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={{ flex: 1 }}
          initialRegion={pin ? { ...pin, latitudeDelta: PICKED_DELTA, longitudeDelta: PICKED_DELTA } : DEFAULT_REGION}
          onPress={handleMapPress}
        >
          {pin ? <Marker coordinate={pin} draggable onDragEnd={handleMarkerDragEnd} /> : null}
        </MapView>
      </View>

      {error ? (
        <AppText color={colors.danger} variant="caption" style={{ marginBottom: spacing.sm }}>
          {error}
        </AppText>
      ) : null}

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <AppButton title="Current location" variant="secondary" loading={locating} onPress={handleUseCurrentLocation} />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <View style={{ flex: 1 }}>
          <AppButton title="Cancel" variant="secondary" onPress={onClose} />
        </View>
        <View style={{ flex: 2 }}>
          <AppButton title="Confirm location" disabled={!pin} loading={confirming} onPress={handleConfirm} />
        </View>
      </View>
    </AppSheet>
  );
}
