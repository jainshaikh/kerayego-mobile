import { View } from 'react-native';
import { AppText } from '../../../components/ui';
import { AVATAR_BG, AVATAR_FG } from '../rideVisuals';

function getInitials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .map((word) => word[0]?.toUpperCase() ?? '')
      .join('')
      .slice(0, 2) || '?'
  );
}

interface RideAvatarProps {
  name: string;
  size?: number;
}

// Rounded initials avatar shared by the driver's Riders tab and the rider's
// Driver tab — same avatar colors as the rest of the live-ride UI (see
// rideVisuals.ts).
export function RideAvatar({ name, size = 40 }: RideAvatarProps) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: AVATAR_BG,
      }}
    >
      <AppText variant="label" color={AVATAR_FG}>
        {getInitials(name)}
      </AppText>
    </View>
  );
}
