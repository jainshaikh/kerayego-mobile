import { View } from 'react-native';

import { AppButton, AppCard, AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';
import type { TripDetail } from '../../../types/api.types';
import type { TripInquiry } from '../../../api/trip-inquiries.api';
import { TripInquiryStatus } from '../../../types/enums';
import { useNow } from '../../../hooks/useNow';
import { openMapsNavigation } from '../../liveRide/openMapsNavigation';
import { formatAgo } from '../../trip-inquiries/riderLiveTrip/riderTripState';
import { hasRidersAwaitingPickup } from './riderLocations';
import { useRiderLocationPins } from './useRiderLocationPins';

interface SharedRiderLocationsCardProps {
  trip: TripDetail;
  inquiries: TripInquiry[];
}

// Before the trip starts (the driver's pre-trip view has no map): riders
// already sharing their location — their windows open 30 min before
// departure — each with when it was last updated and a Map link. Renders
// nothing while nobody is sharing. The live cockpit shows them as map pins.
export function SharedRiderLocationsCard({ trip, inquiries }: SharedRiderLocationsCardProps) {
  const { spacing } = useTheme();
  const accepted = inquiries.filter((inquiry) => inquiry.status === TripInquiryStatus.ACCEPTED);
  const { riders } = useRiderLocationPins({
    tripId: trip.id,
    tripStatus: trip.status,
    departureAt: trip.departureAt,
    ridersAwaitingPickup: hasRidersAwaitingPickup(accepted),
  });
  const now = useNow(riders.length > 0);
  if (riders.length === 0) return null;

  return (
    <AppCard style={{ marginTop: spacing.lg }}>
      <AppText variant="label">Riders sharing their location</AppText>
      {riders.map((rider) => (
        <View
          key={rider.tripInquiryId}
          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText numberOfLines={1}>{rider.riderName}</AppText>
            <AppText muted variant="caption">
              Updated {formatAgo(now - Date.parse(rider.at))}
            </AppText>
          </View>
          <AppButton
            title="Map"
            variant="outline"
            fullWidth={false}
            onPress={() => openMapsNavigation({ lat: rider.lat, lng: rider.lng, label: rider.riderName })}
          />
        </View>
      ))}
    </AppCard>
  );
}
