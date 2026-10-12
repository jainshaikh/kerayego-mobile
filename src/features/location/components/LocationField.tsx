import { useEffect, useId, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
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

// Address input with Places-autocomplete suggestions, plus a "Choose on map"
// button that opens a bottom-sheet map picker (tap/drag pin + current location).
// Suggestions render directly in the component tree beneath the input rather
// than in a native Modal — on Android, a Modal steals window focus and immediately
// blurs the TextInput and dismisses the keyboard. An in-tree dropdown keeps focus
// and the keyboard active while suggestions fetch and display asynchronously.
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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sessionTokenRef = useRef<string>(Crypto.randomUUID());

  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
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
    <View style={{ position: 'relative' }}>
      <AppInput
        label={label ? `${label}${required ? ' *' : ''}` : undefined}
        placeholder={placeholder}
        value={value}
        onChangeText={handleChangeText}
        onFocus={handleFocus}
        error={error}
        autoCorrect={false}
      />

      {open && suggestions.length > 0 ? (
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: radii.md,
            borderWidth: 1,
            borderColor: colors.border,
            maxHeight: 200,
            marginTop: -spacing.xs,
            marginBottom: spacing.sm,
            ...shadowStyle,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.xs,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
          >
            <AppText muted variant="caption" style={{ fontSize: 11 }}>
              Suggestions
            </AppText>
            <Pressable onPress={() => setOpen(false)} hitSlop={8}>
              <AppText muted variant="caption" style={{ fontSize: 13, paddingHorizontal: 4 }}>
                ✕
              </AppText>
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            showsVerticalScrollIndicator
          >
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

      {showMapPicker ? (
        <AppButton
          title="Choose on map"
          variant="secondary"
          fullWidth={false}
          onPress={() => {
            setOpen(false);
            setMapSheetVisible(true);
          }}
          style={{ marginTop: -spacing.sm, marginBottom: spacing.md, alignSelf: 'flex-start' }}
        />
      ) : null}

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
