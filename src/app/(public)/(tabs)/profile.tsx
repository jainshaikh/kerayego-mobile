import { Pressable, View } from 'react-native';
import { router } from 'expo-router';

import { useAuth } from '../../../auth/auth-context';
import { useMyBookingCounts } from '../../../features/booking-requests/queries';
import { useSavedVehicles } from '../../../features/saved-vehicles/queries';
import { AppButton, AppCard, AppRefreshControl, AppScreen, AppText } from '../../../components/ui';
import { usePullToRefresh } from '../../../hooks/usePullToRefresh';
import { useTheme } from '../../../theme';

function MenuRow({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors, spacing } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <View
        style={{
          paddingVertical: spacing.md,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <AppText>{label}</AppText>
        <AppText muted>›</AppText>
      </View>
    </Pressable>
  );
}

function LoggedOutProfile() {
  const { spacing } = useTheme();
  return (
    <AppScreen contentContainerStyle={{ padding: spacing.lg, justifyContent: 'center', flexGrow: 1 }}>
      <AppText variant="title" style={{ marginBottom: spacing.xs, textAlign: 'center' }}>
        Welcome
      </AppText>
      <AppText muted style={{ marginBottom: spacing.xl, textAlign: 'center' }}>
        Log in to save vehicles, send inquiries, and post trips.
      </AppText>
      <AppButton title="Log in" onPress={() => router.push('/login')} />
      <View style={{ marginTop: spacing.md }}>
        <AppButton title="Create account" variant="secondary" onPress={() => router.push('/register')} />
      </View>
    </AppScreen>
  );
}

function CustomerProfile({ user }: { user: { name: string; email: string } }) {
  const { spacing } = useTheme();
  const { logout } = useAuth();
  const counts = useMyBookingCounts();
  const saved = useSavedVehicles();
  const refresh = usePullToRefresh(() => Promise.all([counts.refetch(), saved.refetch()]));

  return (
    <AppScreen
      scroll
      contentContainerStyle={{ padding: spacing.lg }}
      refreshControl={<AppRefreshControl {...refresh} />}
    >
      <AppText variant="title">{user.name}</AppText>
      <AppText muted style={{ marginBottom: spacing.lg }}>
        {user.email}
      </AppText>

      <View style={{ flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg }}>
        <AppCard style={{ flex: 1, alignItems: 'center' }}>
          <AppText variant="title">{counts.data?.active ?? '—'}</AppText>
          <AppText muted variant="caption">
            Active inquiries
          </AppText>
        </AppCard>
        <AppCard style={{ flex: 1, alignItems: 'center' }}>
          <AppText variant="title">{saved.data?.data.length ?? '—'}</AppText>
          <AppText muted variant="caption">
            Saved vehicles
          </AppText>
        </AppCard>
      </View>

      <AppCard style={{ padding: 0, marginBottom: spacing.lg }}>
        <View style={{ paddingHorizontal: spacing.lg }}>
          <MenuRow label="Saved vehicles" onPress={() => router.push('/account/saved')} />
          <MenuRow label="My inquiries" onPress={() => router.push('/account/inquiries')} />
          <MenuRow label="My vehicles (for trips)" onPress={() => router.push('/account/my-vehicles')} />
          <MenuRow label="My trips" onPress={() => router.push('/account/my-trips')} />
          <MenuRow label="Trip requests" onPress={() => router.push('/account/trip-requests')} />
          <MenuRow label="Ratings & reviews" onPress={() => router.push('/account/reviews')} />
          <MenuRow label="Edit profile" onPress={() => router.push('/account/profile')} />
        </View>
      </AppCard>

      <AppButton title="Log out" variant="secondary" onPress={logout} />
    </AppScreen>
  );
}

export default function ProfileScreen() {
  const { user, isAuthenticated } = useAuth();

  if (!isAuthenticated || !user) return <LoggedOutProfile />;
  return <CustomerProfile user={user} />;
}
