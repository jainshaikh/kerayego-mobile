import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../auth/auth-context';
import { Role } from '../../types/enums';

// Reached from the public Profile tab's menu. USER and PROVIDER both use this
// group (personal-vehicle/trip posting is available to either role per the
// backend) — only ADMIN/SUPER_ADMIN have no mobile experience here at all.
export default function AccountLayout() {
  const { isAuthenticated, user } = useAuth();

  if (!isAuthenticated) return <Redirect href="/login" />;
  if (user && 'role' in user && (user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN)) {
    return <Redirect href="/" />;
  }
  if (user?.emailVerified === false) return <Redirect href="/verify-email" />;

  return (
    <Stack screenOptions={{ headerShown: true }}>
      <Stack.Screen name="saved" options={{ title: 'Saved Vehicles' }} />
      <Stack.Screen name="inquiries" options={{ title: 'My Inquiries' }} />
      <Stack.Screen name="inquiry/[id]" options={{ title: 'Inquiry' }} />
      <Stack.Screen name="profile" options={{ title: 'Edit Profile' }} />
      <Stack.Screen name="my-vehicles/index" options={{ title: 'My Vehicles' }} />
      <Stack.Screen name="my-vehicles/new" options={{ title: 'Register Vehicle' }} />
      <Stack.Screen name="my-vehicles/[id]" options={{ title: 'Vehicle Details' }} />
      <Stack.Screen name="my-vehicles/edit/[id]" options={{ title: 'Edit Vehicle' }} />
      <Stack.Screen name="my-trips/index" options={{ title: 'My Trips' }} />
      <Stack.Screen name="my-trips/new" options={{ title: 'Post a Trip' }} />
      <Stack.Screen name="my-trips/[id]" options={{ title: 'Trip Details' }} />
      <Stack.Screen name="reviews" options={{ title: 'Ratings & Reviews' }} />
    </Stack>
  );
}
