import { useState } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';

import { AppButton, AppCard, AppScreen, AppText, StatusBadge, TabBar, type TabBarItem } from '../../../components/ui';
import { useTheme } from '../../../theme';
import type { TripInquiry } from '../../../api/trip-inquiries.api';
import { TripInquiryStatus } from '../../../types/enums';
import { titleCase } from '../../../utils/format';
import { LiveTripMap, type LiveTripStop } from '../../liveRide/components/LiveTripMap';
import { ChatModalSheet } from '../../liveRide/components/ChatModalSheet';
import { openMapsNavigation } from '../../liveRide/openMapsNavigation';
import { formatDistanceShort } from '../../liveRide/geo';
import { formatEtaLabel } from './formatEtaLabel';
import type { RiderLiveRoute, RiderStop } from './useRiderLiveRoute';
import type { RiderTripActions } from './useRiderTripActions';
import type { RideActionAvailability } from './rideActionAvailability';
import { StopsTab } from './StopsTab';
import { DriverTab } from './DriverTab';
import { SummaryTab } from './SummaryTab';

type TripLiveTabKey = 'stops' | 'driver' | 'summary';

const TRIP_LIVE_TABS: TabBarItem[] = [
  { key: 'stops', label: 'Stops' },
  { key: 'driver', label: 'Driver' },
  { key: 'summary', label: 'Summary' },
];

interface RiderLiveViewProps {
  inquiry: TripInquiry;
  pickupStop: RiderStop | null;
  dropoffStop: RiderStop | null;
  dropoffSequence: number;
  availableActions: TripInquiryStatus[];
  isConnected: boolean;
  route: RiderLiveRoute;
  riderActions: RiderTripActions;
  rideActionAvailability: RideActionAvailability;
}

// The rider's tripLive layout: ride header + map/overlay on top, a tap-only
// tab bar (Stops / Driver / Summary) below it, a flex:1 area rendering
// whichever tab is selected, then a pinned action bar. Chat is a modal
// opened from the Driver tab, mirroring the driver's own my-trips/[id].tsx
// cockpit (Stops/Riders/Details + modal chat).
export function RiderLiveView({
  inquiry,
  pickupStop,
  dropoffStop,
  dropoffSequence,
  availableActions,
  isConnected,
  route,
  riderActions,
  rideActionAvailability,
}: RiderLiveViewProps) {
  const { colors, spacing, radii, shadows } = useTheme();
  const [activeTab, setActiveTab] = useState<TripLiveTabKey>('stops');
  const [chatOpen, setChatOpen] = useState(false);

  const { riderConfirmedAtPickup } = riderActions;
  const etaTarget: 'pickup' | 'dropoff' = inquiry.pickupConfirmedAt ? 'dropoff' : 'pickup';
  const showEta = route.etaMinutes !== null && !inquiry.droppedOffAt;
  const pickupReached = riderConfirmedAtPickup || !!inquiry.pickupConfirmedAt;

  const driverName = inquiry.trip.postedBy.name;
  const driverPhone = inquiry.trip.postedBy.phone;
  const vehicleName = `${titleCase(inquiry.trip.userVehicle.make)} ${titleCase(inquiry.trip.userVehicle.model)}`;
  const vehiclePlate = inquiry.trip.userVehicle.plateNumber;

  const pickupDistanceLabel =
    route.pickupDistanceM !== null ? `${formatDistanceShort(route.pickupDistanceM / 1000)} from you` : null;
  const driverDistanceLabel = route.driverDistanceKm !== null ? formatDistanceShort(route.driverDistanceKm) : null;

  // Map overlay banner: two distinct states gated on the LOCAL
  // riderConfirmedAtPickup flag. The post-confirmation state's eta/distance
  // numbers are the existing, real, throttled route.etaMinutes/
  // driverDistanceKm — never a fabricated always-on value.
  const bannerCaption = riderConfirmedAtPickup
    ? driverDistanceLabel
      ? `Driver arriving · ${driverDistanceLabel}`
      : 'Driver arriving'
    : pickupDistanceLabel
      ? `Your pickup · ${pickupDistanceLabel}`
      : 'Your pickup';
  const bannerTitle = riderConfirmedAtPickup
    ? showEta
      ? `${driverName} is ${formatEtaLabel(route.etaMinutes as number)} away`
      : `${driverName} is on the way`
    : (pickupStop?.label ?? 'Pickup point');
  const bannerActionTitle = riderConfirmedAtPickup ? 'Track' : 'Navigate';
  const handleBannerAction = () => {
    if (riderConfirmedAtPickup) return; // "Track": no imperative recenter API is exposed by LiveTripMap
    // (out of scope) and the map already re-fits to `stops` on every change,
    // so this is intentionally a no-op.
    if (pickupStop) openMapsNavigation(pickupStop);
  };

  const progressTitle = inquiry.droppedOffAt
    ? 'Ride completed'
    : showEta
      ? etaTarget === 'pickup'
        ? `Pickup in ${formatEtaLabel(route.etaMinutes as number)}`
        : `Dropoff in ${formatEtaLabel(route.etaMinutes as number)}`
      : riderConfirmedAtPickup
        ? 'Waiting for driver'
        : 'Head to your pickup point';
  const progressMeta = dropoffStop ? `Arriving ${dropoffStop.label}` : `Arriving ${titleCase(inquiry.trip.destinationCity)}`;

  // pickupStop/dropoffStop carry no `type` field of their own (unlike
  // ManifestRouteStop on the driver side), so it's added here to satisfy
  // LiveTripMap's LiveTripStop shape. Pickup is always sequence 1 and swaps
  // 'selected' → 'reached' once the rider has locally confirmed being at the
  // stop — matching the reference mockup's pin logic exactly. Dropoff always
  // renders 'upcoming'.
  const mapStops: LiveTripStop[] = [
    pickupStop
      ? {
          id: pickupStop.id,
          type: 'PICKUP' as const,
          label: pickupStop.label,
          lat: pickupStop.lat,
          lng: pickupStop.lng,
          sequence: 1,
          status: riderConfirmedAtPickup ? ('reached' as const) : ('selected' as const),
        }
      : null,
    dropoffStop
      ? {
          id: dropoffStop.id,
          type: 'DROPOFF' as const,
          label: dropoffStop.label,
          lat: dropoffStop.lat,
          lng: dropoffStop.lng,
          sequence: dropoffSequence,
          status: 'upcoming' as const,
        }
      : null,
    ...route.otherTripStops,
  ].filter((stop): stop is LiveTripStop => stop !== null);

  return (
    <AppScreen edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: 'Trip request' }} />

      <View style={{ flex: 1 }}>
        {/* Ride header */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: spacing.md,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.sm,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText muted variant="caption">
              Your ride · today
            </AppText>
            <AppText variant="title" numberOfLines={1} style={{ textTransform: 'capitalize' }}>
              {titleCase(inquiry.trip.originCity)} → {titleCase(inquiry.trip.destinationCity)}
            </AppText>
          </View>
          <StatusBadge
            label={riderConfirmedAtPickup ? 'Driver On The Way' : 'Head To Pickup'}
            tone={riderConfirmedAtPickup ? 'success' : 'warning'}
          />
        </View>

        {/* Map section: pinned, plus its bottom-anchored overlay banner. */}
        <View style={{ height: 340, marginHorizontal: spacing.lg, marginTop: spacing.lg, borderRadius: radii.card, overflow: 'hidden' }}>
          <LiveTripMap
            stops={mapStops}
            driverPosition={route.driverPosition}
            isConnected={isConnected}
            lastUpdateAt={route.driverLastUpdateAt}
            routePolyline={route.routePolyline}
            driverLabel="D"
          />

          {pickupStop ? (
            <AppCard style={{ position: 'absolute', left: spacing.md, right: spacing.md, bottom: spacing.md, ...shadows.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <AppText muted variant="caption" numberOfLines={1}>
                    {bannerCaption}
                  </AppText>
                  <AppText variant="subtitle" numberOfLines={1}>
                    {bannerTitle}
                  </AppText>
                </View>
                <AppButton title={bannerActionTitle} variant="secondary" fullWidth={false} onPress={handleBannerAction} />
              </View>
            </AppCard>
          ) : null}
        </View>

        {/* Tabs */}
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md }}>
          <TabBar tabs={TRIP_LIVE_TABS} activeKey={activeTab} onChange={(key) => setActiveTab(key as TripLiveTabKey)} />
        </View>

        <View style={{ flex: 1 }}>
          <View style={{ flex: 1, display: activeTab === 'stops' ? 'flex' : 'none' }}>
            <StopsTab
              inquiry={inquiry}
              pickupStop={pickupStop}
              dropoffStop={dropoffStop}
              dropoffSequence={dropoffSequence}
              pickupDistanceM={route.pickupDistanceM}
              dropoffDistanceM={route.dropoffDistanceM}
              pickupReached={pickupReached}
              riderConfirmedAtPickup={riderConfirmedAtPickup}
              showEta={showEta}
              etaMinutes={route.etaMinutes}
              driverDistanceKm={route.driverDistanceKm}
              vehicleName={vehicleName}
              vehiclePlate={vehiclePlate}
              rideActionAvailability={rideActionAvailability}
              actioningType={riderActions.actioningType}
              onRiderEvent={riderActions.handleRiderEvent}
              tripStopsSorted={route.tripStopsSorted}
              tripStopsLoading={route.tripStopsLoading}
              actionError={riderActions.actionError}
            />
          </View>
          <View style={{ flex: 1, display: activeTab === 'driver' ? 'flex' : 'none' }}>
            <DriverTab
              driverName={driverName}
              driverPhone={driverPhone}
              riderConfirmedAtPickup={riderConfirmedAtPickup}
              vehicleName={vehicleName}
              vehiclePlate={vehiclePlate}
              vehicleColor={route.vehicleColor}
              vehicleYear={route.vehicleYear}
              onOpenChat={() => setChatOpen(true)}
            />
          </View>
          <View style={{ flex: 1, display: activeTab === 'summary' ? 'flex' : 'none' }}>
            <SummaryTab inquiry={inquiry} pickupStop={pickupStop} dropoffStop={dropoffStop} />
          </View>
        </View>

        {/* Action bar (pinned): progress on the left, the real cancel-seat
            action on the right. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: spacing.md,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.md,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            backgroundColor: colors.background,
          }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText variant="label" numberOfLines={1}>
              {progressTitle}
            </AppText>
            <AppText muted variant="caption" numberOfLines={1}>
              {progressMeta}
            </AppText>
          </View>
          {availableActions.includes(TripInquiryStatus.CANCELLED) ? (
            <AppButton
              title="Cancel seat"
              variant="danger"
              fullWidth={false}
              loading={riderActions.updateStatusPending}
              onPress={riderActions.handleCancel}
            />
          ) : null}
        </View>
      </View>

      {/* Chat — modal, opened from the Driver tab's Chat button, reusing the
          exact same ChatModalSheet component the driver screen's own cockpit
          uses (wrapping ChatPanel, untouched). ChatModalSheet's props are
          named for a per-rider pickup/dropoff subtitle on the driver's
          screen; reused here for a vehicle-name/plate subtitle instead — no
          internals changed. */}
      <ChatModalSheet
        visible={chatOpen}
        onClose={() => setChatOpen(false)}
        tripInquiryId={inquiry.id}
        riderName={driverName}
        pickupLabel={vehicleName}
        dropoffLabel={vehiclePlate}
      />
    </AppScreen>
  );
}
