import { Pressable, View } from 'react-native';
import { useTheme } from '../../theme';
import { AppText } from './AppText';

export interface TabBarItem {
  key: string;
  label: string;
}

interface TabBarProps {
  tabs: TabBarItem[];
  activeKey: string;
  onChange: (key: string) => void;
}

// Tap-only tab switcher — no swipe gesture/pager, by design (see the
// tab-bar-below-map screens that use this: a swipeable pager risks an
// accidental tab change while a vehicle may be moving). Visual style mirrors
// the selectable-pill Chip in TripInquiryFormSheet for consistency with this
// app's existing pill/tab language, just stretched to fill the row.
export function TabBar({ tabs, activeKey, onChange }: TabBarProps) {
  const { colors, radii, spacing } = useTheme();

  return (
    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={{
              flex: 1,
              alignItems: 'center',
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              borderRadius: radii.chip,
              borderWidth: 1,
              borderColor: active ? colors.primary : colors.border,
              backgroundColor: active ? colors.primary : 'transparent',
            }}
          >
            <AppText variant="label" color={active ? colors.primaryText : colors.text}>
              {tab.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}
