import { useEffect, useId, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as Crypto from 'expo-crypto';

import { AppButton, AppInput, AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';
import { geoApi, type PlaceSuggestion } from '../../../api/geo.api';
import { setActiveAutocomplete, subscribeActiveAutocomplete } from '../activeAutocomplete';
import { LocationMapSheet } from './LocationMapSheet';

interface LocationFieldProps {
  label?: string;
  required?: boolean;
  value: string;
  onChangeText: (text: string) => void;
  lat?: number;
  lng?: number;
  onLocationChange: (lat: number, lng: number) => void;
  placeholder?: string;
  error?: string;
  /** CLDR region codes to bias/restrict results, e.g. ['PK', 'AE', 'SA']. */
  regionCodes?: string[];
  /** Hide the "Choose on map" pin-drop button — e.g. a plain location search filter has no map to drop a pin on. Defaults to true. */
  showMapPicker?: boolean;
}

const DEBOUNCE_MS = 300;
interface Measured {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Mobile equivalent of web's MapLocationField/MapLocationPicker/
// PlaceAutocompleteInput trio, collapsed into one component: an address
// input with Places-autocomplete suggestions, plus a "Choose on map" button
// that opens a bottom-sheet map picker (tap/drag pin + current location).
// Suggestions render inside a transparent Modal positioned over the input —
// RN has no DOM "outside click", so the Modal's full-screen backdrop
// Pressable is what makes tapping anywhere else close the dropdown, and the
// activeAutocomplete registry is what makes focusing a sibling field
// (e.g. drop-off) close this one's dropdown the same way the web fix does.
export function LocationField({
  label,
  required,
  value,
  onChangeText,
  lat,
  lng,
  onLocationChange,
  placeholder,
  error,
  regionCodes,
  showMapPicker = true,
}: LocationFieldProps) {
  const { colors, spacing, radii } = useTheme();
  const instanceId = useId();
  const fieldRef = useRef<View>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sessionTokenRef = useRef<string>(Crypto.randomUUID());

  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [measured, setMeasured] = useState<Measured | null>(null);
  const [mapSheetVisible, setMapSheetVisible] = useState(false);

  useEffect(() => subscribeActiveAutocomplete((activeId) => {
    if (activeId !== instanceId) setOpen(false);
  }), [instanceId]);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const fetchSuggestions = (text: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!text.trim()) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const results = await geoApi.autocompletePlaces(text, regionCodes, sessionTokenRef.current);
        setSuggestions(results);
        setOpen(results.length > 0);
        if (results.length > 0) setActiveAutocomplete(instanceId);
      } catch {
        setSuggestions([]);
        setOpen(false);
      }
    }, DEBOUNCE_MS);
  };

  const handleChangeText = (text: string) => {
    onChangeText(text);
    fetchSuggestions(text);
  };

  const handleFocus = () => {
    setActiveAutocomplete(instanceId);
    fieldRef.current?.measureInWindow((x, y, width, height) => setMeasured({ x, y, width, height }));
    if (suggestions.length > 0) setOpen(true);
  };

  const handleSelect = async (suggestion: PlaceSuggestion) => {
    setOpen(false);
    setActiveAutocomplete(null);
    try {
      const details = await geoApi.getPlaceDetails(suggestion.placeId, sessionTokenRef.current);
      onChangeText(details.formattedAddress || suggestion.text);
      onLocationChange(details.lat, details.lng);
    } catch {
      // Fall back to the plain suggestion text — coordinates just won't be set.
      onChangeText(suggestion.text);
    } finally {
      // A session ends once a place's details are fetched — start a fresh
      // one for the next search rather than reusing a spent token.
      sessionTokenRef.current = Crypto.randomUUID();
    }
  };

  return (
    <View>
      <View ref={fieldRef} collapsable={false}>
        <AppInput
          label={label ? `${label}${required ? ' *' : ''}` : undefined}
          placeholder={placeholder}
          value={value}
          onChangeText={handleChangeText}
          onFocus={handleFocus}
          error={error}
          autoCorrect={false}
        />
      </View>

      {showMapPicker ? (
        <AppButton
          title="Choose on map"
          variant="secondary"
          fullWidth={false}
          onPress={() => setMapSheetVisible(true)}
          style={{ marginTop: -spacing.sm, marginBottom: spacing.md, alignSelf: 'flex-start' }}
        />
      ) : null}

      <Modal visible={open} transparent animationType="none" onRequestClose={() => setOpen(false)}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
        {measured ? (
          <View
            style={{
              position: 'absolute',
              left: measured.x,
              top: measured.y + measured.height + 4,
              width: measured.width,
              maxHeight: 240,
              backgroundColor: colors.surface,
              borderRadius: radii.md,
              borderWidth: 1,
              borderColor: colors.border,
              ...shadowStyle,
            }}
          >
            <ScrollView keyboardShouldPersistTaps="handled">
              {suggestions.map((s) => (
                <Pressable
                  key={s.placeId}
                  onPress={() => handleSelect(s)}
                  style={({ pressed }) => ({
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.sm,
                    backgroundColor: pressed ? colors.surfaceAlt : 'transparent',
                  })}
                >
                  <AppText variant="caption">{s.text}</AppText>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </Modal>

      <LocationMapSheet
        visible={mapSheetVisible}
        onClose={() => setMapSheetVisible(false)}
        initialLat={lat}
        initialLng={lng}
        onConfirm={(result) => {
          if (result.address) onChangeText(result.address);
          onLocationChange(result.lat, result.lng);
          setMapSheetVisible(false);
        }}
      />
    </View>
  );
}

const shadowStyle = {
  shadowColor: '#3C141E',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.12,
  shadowRadius: 12,
  elevation: 6,
};
