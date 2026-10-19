import { createContext, useCallback, useContext, useEffect, useId, useState, type ReactNode } from 'react';
import type { ScrollViewProps } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { useTheme } from '../../theme';

type ReserveSpace = (id: string, px: number) => void;

const ReserveSpaceContext = createContext<ReserveSpace | null>(null);

interface FormScrollViewProps extends ScrollViewProps {
  children: ReactNode;
}

// The app's scroll view for any screen with text inputs. The app is
// edge-to-edge, so Android no longer shrinks the window when the keyboard
// opens — this scrolls the focused input (plus room for its error/helper
// line) above the keyboard instead, on both platforms.
export function FormScrollView({ children, ...props }: FormScrollViewProps) {
  const { spacing } = useTheme();
  // Extra room fields have asked for below the focused input (an open
  // autocomplete dropdown) — the largest one wins.
  const [reservations, setReservations] = useState<Record<string, number>>({});

  const reserve = useCallback<ReserveSpace>((id, px) => {
    setReservations((prev) => {
      if ((prev[id] ?? 0) === px) return prev;
      const next = { ...prev };
      if (px > 0) next[id] = px;
      else delete next[id];
      return next;
    });
  }, []);

  const extraSpace = Math.max(0, ...Object.values(reservations));

  return (
    <ReserveSpaceContext.Provider value={reserve}>
      {/* Changing bottomOffset re-runs the library's "is the focused input
          clear of the keyboard?" check, so a dropdown opening scrolls it into
          view with no extra plumbing. */}
      <KeyboardAwareScrollView
        keyboardShouldPersistTaps="handled"
        bottomOffset={spacing.xl + extraSpace}
        {...props}
      >
        {children}
      </KeyboardAwareScrollView>
    </ReserveSpaceContext.Provider>
  );
}

// Keeps `px` of space visible between the focused input and the keyboard,
// for content that opens beneath the input (e.g. a suggestions dropdown).
// A no-op outside a FormScrollView. Pass 0 to release it.
export function useKeyboardSpaceBelow(px: number) {
  const reserve = useContext(ReserveSpaceContext);
  const id = useId();

  useEffect(() => {
    if (!reserve) return;
    reserve(id, px);
    return () => reserve(id, 0);
  }, [reserve, id, px]);
}
