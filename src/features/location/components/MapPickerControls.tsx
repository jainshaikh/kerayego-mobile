import { useEffect, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../../../theme';

const PIN_HEAD = 30;
const PIN_STEM = 14;
const PIN_HEIGHT = PIN_HEAD + PIN_STEM;
const PIN_LIFT = 10;
const CONTROL_SIZE = 40;

// A fixed pin whose stem tip sits exactly on the map's centre — the map moves
// underneath it, so the picked spot is always the map centre. It lifts while
// the map is moving and drops back once it settles.
export function CenterPin({ lifted }: { lifted: boolean }) {
  const { colors, shadows } = useTheme();
  const [lift] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.spring(lift, {
      toValue: lifted ? 1 : 0,
      speed: 24,
      bounciness: lifted ? 0 : 10,
      useNativeDriver: true,
    }).start();
  }, [lifted, lift]);

  const translateY = lift.interpolate({ inputRange: [0, 1], outputRange: [0, -PIN_LIFT] });
  const shadowScale = lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] });

  return (
    <>
      {/* Ground shadow, centred on the exact spot being picked. */}
      <View pointerEvents="none" style={styles.centered}>
        <Animated.View
          style={{
            width: 10,
            height: 4,
            borderRadius: 5,
            backgroundColor: 'rgba(0,0,0,0.35)',
            transform: [{ scaleX: shadowScale }],
          }}
        />
      </View>
      {/* marginBottom equal to the pin's own height puts its bottom edge (the
          stem tip) on the centre line instead of its middle. */}
      <View pointerEvents="none" style={styles.centered}>
        <Animated.View style={{ alignItems: 'center', marginBottom: PIN_HEIGHT, transform: [{ translateY }] }}>
          <View
            style={{
              width: PIN_HEAD,
              height: PIN_HEAD,
              borderRadius: PIN_HEAD / 2,
              borderWidth: 3,
              borderColor: '#FFFFFF',
              backgroundColor: colors.primary,
              alignItems: 'center',
              justifyContent: 'center',
              ...shadows.md,
            }}
          >
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFFFFF' }} />
          </View>
          <View
            style={{
              width: 3,
              height: PIN_STEM,
              borderBottomLeftRadius: 2,
              borderBottomRightRadius: 2,
              backgroundColor: colors.primary,
            }}
          />
        </Animated.View>
      </View>
    </>
  );
}

interface MapControlsProps {
  locating: boolean;
  onLocate: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

// Bottom-right map controls: current location above a +/− zoom pair.
export function MapControls({ locating, onLocate, onZoomIn, onZoomOut }: MapControlsProps) {
  const { colors, radii, spacing, shadows } = useTheme();

  const groupStyle = {
    width: CONTROL_SIZE,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    ...shadows.sm,
  };

  return (
    <View style={{ position: 'absolute', right: spacing.sm, bottom: spacing.sm, gap: spacing.sm }}>
      <View style={groupStyle}>
        <ControlButton
          icon="locate"
          accessibilityLabel="Go to my current location"
          loading={locating}
          onPress={onLocate}
        />
      </View>
      <View style={groupStyle}>
        <ControlButton icon="add" accessibilityLabel="Zoom in" onPress={onZoomIn} />
        <View style={{ height: 1, marginHorizontal: spacing.sm, backgroundColor: colors.border }} />
        <ControlButton icon="remove" accessibilityLabel="Zoom out" onPress={onZoomOut} />
      </View>
    </View>
  );
}

interface ControlButtonProps {
  icon: keyof typeof Ionicons.glyphMap;
  accessibilityLabel: string;
  onPress: () => void;
  loading?: boolean;
}

function ControlButton({ icon, accessibilityLabel, onPress, loading = false }: ControlButtonProps) {
  const { colors, radii } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({
        width: CONTROL_SIZE,
        height: CONTROL_SIZE,
        borderRadius: radii.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? colors.surfaceAlt : 'transparent',
      })}
    >
      {loading ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <Ionicons name={icon} size={22} color={colors.text} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  centered: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
});
