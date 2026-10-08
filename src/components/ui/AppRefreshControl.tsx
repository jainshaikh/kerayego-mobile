import { RefreshControl, type RefreshControlProps } from 'react-native';
import { useTheme } from '../../theme';

// Themed pull-to-refresh spinner — pass it as any ScrollView/FlatList's
// `refreshControl`, usually spread from usePullToRefresh(). Every prop is
// forwarded, including the `style`/`children` an Android ScrollView injects
// when it clones its refreshControl to wrap itself.
export function AppRefreshControl(props: RefreshControlProps) {
  const { colors } = useTheme();
  return (
    <RefreshControl
      tintColor={colors.primary}
      colors={[colors.primary]}
      progressBackgroundColor={colors.surface}
      {...props}
    />
  );
}
