import { useCallback, useEffect, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';

import { geoApi, type PlaceDetails, type PlaceSuggestion } from '../../api/geo.api';

const DEBOUNCE_MS = 300;

// Debounced Places autocomplete shared by LocationField's dropdown and the map
// picker's search bar. Holds one Places session token per search — a session
// ends once a place's details are fetched, so resolve() starts a fresh one.
export function usePlaceSearch(regionCodes?: string[]) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sessionTokenRef = useRef<string>(Crypto.randomUUID());
  // Bumped on every keystroke so a slow response for an older query can't
  // overwrite the suggestions for what's typed now.
  const requestSeqRef = useRef(0);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  // Joined so a caller passing a fresh array literal each render doesn't
  // change search()'s identity.
  const regionKey = regionCodes?.join(',');

  // onResults runs once this query's suggestions land (empty on a blank query
  // or a failed lookup) — never for a query superseded by a newer keystroke.
  const search = useCallback(
    (text: string, onResults?: (results: PlaceSuggestion[]) => void) => {
      clearTimeout(debounceRef.current);
      const seq = ++requestSeqRef.current;

      if (!text.trim()) {
        setSuggestions([]);
        onResults?.([]);
        return;
      }

      debounceRef.current = setTimeout(async () => {
        let results: PlaceSuggestion[];
        try {
          results = await geoApi.autocompletePlaces(text, regionKey?.split(','), sessionTokenRef.current);
        } catch {
          results = [];
        }
        if (seq !== requestSeqRef.current) return;
        setSuggestions(results);
        onResults?.(results);
      }, DEBOUNCE_MS);
    },
    [regionKey],
  );

  const clear = useCallback(() => {
    clearTimeout(debounceRef.current);
    requestSeqRef.current += 1;
    setSuggestions([]);
  }, []);

  // Throws if the details lookup fails — callers decide the fallback.
  const resolve = useCallback(async (suggestion: PlaceSuggestion): Promise<PlaceDetails> => {
    try {
      return await geoApi.getPlaceDetails(suggestion.placeId, sessionTokenRef.current);
    } finally {
      sessionTokenRef.current = Crypto.randomUUID();
    }
  }, []);

  return { suggestions, search, clear, resolve };
}
