import { useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';
import type { PlaceSuggestion } from '../../../api/geo.api';
import { usePlaceSearch } from '../usePlaceSearch';

interface MapPlaceSearchProps {
  regionCodes?: string[];
  onSelect: (place: { latitude: number; longitude: number; address: string }) => void;
  onError: (message: string) => void;
}

// Search box floating over the top of the map picker, so the user can jump
// straight to an area instead of panning in from a country-wide view.
// Suggestions only show while the box is focused — dragging or tapping the map
// dismisses the keyboard, which blurs the box and tucks them away.
export function MapPlaceSearch({ regionCodes, onSelect, onError }: MapPlaceSearchProps) {
  const { colors, spacing, radii, fontSize, shadows } = useTheme();
  const { suggestions, search, clear, resolve } = usePlaceSearch(regionCodes);
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [resolving, setResolving] = useState(false);

  const handleChangeText = (text: string) => {
    setQuery(text);
    search(text);
  };

  const handleClear = () => {
    setQuery('');
    clear();
  };

  const handleSelect = async (suggestion: PlaceSuggestion) => {
    Keyboard.dismiss();
    setQuery(suggestion.text);
    setResolving(true);
    try {
      const details = await resolve(suggestion);
      onSelect({
        latitude: details.lat,
        longitude: details.lng,
        address: details.formattedAddress || suggestion.text,
      });
    } catch {
      onError("Couldn't open that place — try another one or move the map instead.");
    } finally {
      setResolving(false);
    }
  };

  const showSuggestions = focused && suggestions.length > 0;

  return (
    <View style={{ position: 'absolute', top: spacing.sm, left: spacing.sm, right: spacing.sm }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          minHeight: 46,
          paddingHorizontal: spacing.md,
          borderRadius: radii.md,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          ...shadows.md,
        }}
      >
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={handleChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={() => {
            if (suggestions[0]) handleSelect(suggestions[0]);
          }}
          placeholder="Search area, street or landmark"
          placeholderTextColor={colors.textFaint}
          returnKeyType="search"
          autoCorrect={false}
          accessibilityLabel="Search for a place"
          style={{ flex: 1, paddingVertical: spacing.sm, color: colors.text, fontSize: fontSize.md }}
        />
        {resolving ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : query ? (
          <Pressable onPress={handleClear} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={18} color={colors.textFaint} />
          </Pressable>
        ) : null}
      </View>

      {showSuggestions ? (
        <View
          style={{
            marginTop: spacing.xs,
            maxHeight: 220,
            borderRadius: radii.md,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surface,
            ...shadows.md,
          }}
        >
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
            {suggestions.map((s, index) => (
              <Pressable
                key={s.placeId}
                onPress={() => handleSelect(s)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.sm,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm + 2,
                  borderTopWidth: index === 0 ? 0 : 1,
                  borderTopColor: colors.border,
                  backgroundColor: pressed ? colors.surfaceAlt : 'transparent',
                })}
              >
                <Ionicons name="location-outline" size={16} color={colors.textMuted} />
                <AppText variant="caption" numberOfLines={2} style={{ flex: 1 }}>
                  {s.text}
                </AppText>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}
