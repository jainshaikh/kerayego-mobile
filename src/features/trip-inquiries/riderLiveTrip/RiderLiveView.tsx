import { useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { AppButton, AppCard, AppText, StatusBadge, TabBar, type TabBarItem } from '../../../components/ui';
import { useTheme } from '../../../theme';
import type { TripInquiry } from '../../../api/trip-inquiries.api';
import { TripInquiryStatus } from '../../../types/enums';
import { titleCase } from '../../../utils/format';
import { LiveTripMap, type LiveTripStop } from '../../liveRide/components/LiveTripMap';
import { ChatModalSheet } from '../../liveRide/components/ChatModalSheet';
import { mapsNavigationUrl, openMapsNavigation } from '../../liveRide/openMapsNavigation';
import { formatDistanceShort } from '../../liveRide/geo';
import type { ServerClock } from '../../trips/driverCockpit/noShow';
import type { OfflineTripQueue } from '../../trips/offlineSync';
import { OfflineQueueNotice } from '../../trips/components/OfflineQueueNotice';
import { formatEtaLabel } from './formatEtaLabel';
import type { RiderLiveRoute, RiderStop } from './useRiderLiveRoute';
import type { RiderTripActions } from './useRiderTripActions';
import type { RideActionAvailability } from './rideActionAvailability';
import { deriveRiderRidePhase, liveRideCopy } from './riderTripState';
import { hasCoordinates } from './routeStops';
import { driverCallNumber } from './tripDisplay';
import { DriverArrivedAgo } from './DriverArrivedAgo';
import { RiderConfirmSheet } from './RiderConfirmSheet';
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
  availableActions: TripInquiryStatus[];
  isConnected: boolean;
  route: RiderLiveRoute;
  riderActions: RiderTripActions;
  rideActionAvailability: RideActionAvailability;
  offlineQueue: OfflineTripQueue;
  // From the request's serverNow — times "driver arrived N min ago" on the
  // server's clock. null on an older backend.
  serverClock: ServerClock | null;
  // The chat sheet — owned by the screen, which a chat push can open it from.
  chatOpen: boolean;
  onOpenChat: () => void;
  onCloseChat: () => void;
}

interface MapBanner {
  caption: ReactNode;
  title: string;
  onNavigate: (() => void) | null;
}

// The rider's live-ride layout, shown only while the ride lock holds (seat
// accepted, trip running, not yet dropped off or marked a no-show): ride
// header + map/overlay on top, a tap-only tab bar (Stops / Driver / Summary)
// below it, a flex:1 area rendering whichever tab is selected, then a pinned
// action bar. Chat is a modal opened from the Driver tab, mirroring the
// driver's own my-trips/[id].tsx cockpit (Stops/Riders/Details + modal chat).
// The screen (trip-request/[id].tsx) owns the AppScreen, header and back lock.
export function RiderLiveView({
  inquiry,
  pickupStop,
  dropoffStop,
  availableActions,
  isConnected,
  route,
  riderActions,
  rideActionAvailability,
  offlineQueue,
  serverClock,
  chatOpen,
  onOpenChat,
  onCloseChat,
}: RiderLiveViewProps) {
  const { colors, spacing, radii, shadows } = useTheme();
  const [activeTab, setActiveTab] = useState<TripLiveTabKey>('stops');

  // Server truth first: the driver's Pickup moves the rider on board; the
  // rider's own "I reached the stop" only matters before that.
  const phase = deriveRiderRidePhase({
    pickupConfirmedAt: inquiry.pickupConfirmedAt,
    riderConfirmedAtPickup: riderActions.riderConfirmedAtPickup,
  });
  const driverArrivedAt = inquiry.pickupStop?.arrivedAt ?? null;
  const driverAtPickup = phase !== 'onBoard' && !!driverArrivedAt;
  const dropoffQueued = !!riderActions.optimisticDroppedOffAt;
  const copy = liveRideCopy({ phase, driverAtPickup, etaMinutes: route.etaMinutes, dropoffQueued });

  const { trip } = inquiry;
  const driverName = trip.postedBy.name;
  const vehicleName = `${titleCase(trip.userVehicle.make)} ${titleCase(trip.userVehicle.model)}`;
  const vehiclePlate = trip.userVehicle.plateNumber;

  const pickupDistanceLabel =
    route.pickupDistanceM !== null ? `${formatDistanceShort(route.pickupDistanceM / 1000)} from you` : null;
  const dropoffDistanceLabel =
    route.dropoffDistanceM !== null ? `${formatDistanceShort(route.dropoffDistanceM / 1000)} from you` : null;
  const driverDistanceLabel = route.driverDistanceKm !== null ? formatDistanceShort(route.driverDistanceKm) : null;
  const navigateToPickup = pickupStop && mapsNavigationUrl(pickupStop) ? () => openMapsNavigation(pickupStop) : null;

  // Map overlay banner — what the rider needs right now, by phase. On board
  // it's where they're headed (they aren't driving, so no Navigate); before
  // pickup it's the driver at the stop, the driver on the way (once the
  // rider is waiting), or the stop to head to.
  let banner: MapBanner | null = null;
  if (phase === 'onBoard') {
    if (dropoffStop) {
      banner = {
        caption: dropoffDistanceLabel ? `Your drop-off · ${dropoffDistanceLabel}` : 'Your drop-off',
        title: dropoffStop.label,
        onNavigate: null,
      };
    }
  } else if (driverAtPickup) {
    banner = {
      caption: <DriverArrivedAgo arrivedAt={driverArrivedAt} serverClock={serverClock} visible />,
      title: `${driverName} is at your pickup`,
      onNavigate: phase === 'headToPickup' ? navigateToPickup : null,
    };
  } else if (phase === 'waitingAtPickup') {
    banner = {
      caption: driverDistanceLabel ? `Driver arriving · ${driverDistanceLabel}` : 'Driver arriving',
      title:
        route.etaMinutes !== null
          ? `${driverName} is ${formatEtaLabel(route.etaMinutes)} away`
          : `${driverName} is on the way`,
      onNavigate: null,
    };
  } else if (pickupStop) {
    banner = {
      caption: pickupDistanceLabel ? `Your pickup · ${pickupDistanceLabel}` : 'Your pickup',
      title: pickupStop.label,
      onNavigate: navigateToPickup,
    };
  }

  const progressMeta = dropoffStop ? `Arriving ${dropoffStop.label}` : `Arriving ${titleCase(trip.destinationCity)}`;

  // pickupStop/dropoffStop carry no `type` field of their own (unlike
  // ManifestRouteStop on the driver side), so it's added here to satisfy
  // LiveTripMap's LiveTripStop shape. The stop the rider is heading for is
  // 'selected' (pickup before it, drop-off once on board); a stop already
  // behind them is 'reached'. A stop typed as free text has no coordinates
  // and gets no pin.
  const mapStops: LiveTripStop[] = [...route.otherTripStops];
  if (hasCoordinates(pickupStop)) {
    mapStops.push({
      id: pickupStop.id,
      type: 'PICKUP',
      label: pickupStop.label,
      lat: pickupStop.lat,
      lng: pickupStop.lng,
      sequence: route.pickupSequence,
      status: phase === 'headToPickup' ? 'selected' : 'reached',
    });
  }
  if (hasCoordinates(dropoffStop)) {
    mapStops.push({
      id: dropoffStop.id,
      type: 'DROPOFF',
      label: dropoffStop.label,
      lat: dropoffStop.lat,
      lng: dropoffStop.lng,
      sequence: route.dropoffSequence,
      status: dropoffQueued ? 'reached' : phase === 'onBoard' ? 'selected' : 'upcoming',
    });
  }

  return (
    <>
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
              {titleCase(trip.originCity)} → {titleCase(trip.destinationCity)}
            </AppText>
          </View>
          <StatusBadge label={copy.badge.label} tone={copy.badge.tone} />
        </View>

        <OfflineQueueNotice queue={offlineQueue} variant="bar" />

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

          {banner ? (
            <AppCard style={{ position: 'absolute', left: spacing.md, right: spacing.md, bottom: spacing.md, ...shadows.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  {typeof banner.caption === 'string' ? (
                    <AppText muted variant="caption" numberOfLines={1}>
                      {banner.caption}
                    </AppText>
                  ) : (
                    banner.caption
                  )}
                  <AppText variant="subtitle" numberOfLines={1}>
                    {banner.title}
                  </AppText>
                </View>
                {banner.onNavigate ? (
                  <AppButton title="Navigate" variant="secondary" fullWidth={false} onPress={banner.onNavigate} />
                ) : null}
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
              phase={phase}
              pickupStop={pickupStop}
              dropoffStop={dropoffStop}
              pickupSequence={route.pickupSequence}
              dropoffSequence={route.dropoffSequence}
              pickupDistanceM={route.pickupDistanceM}
              dropoffDistanceM={route.dropoffDistanceM}
              pickupConfirmedAt={inquiry.pickupConfirmedAt}
              driverArrivedAt={driverArrivedAt}
              serverClock={serverClock}
              visible={activeTab === 'stops'}
              dropoffQueued={dropoffQueued}
              etaMinutes={route.etaMinutes}
              driverDistanceKm={route.driverDistanceKm}
              vehicleName={vehicleName}
              vehiclePlate={vehiclePlate}
              rideActionAvailability={rideActionAvailability}
              actioningType={riderActions.actioningType}
              onArrived={riderActions.handleArrived}
              onCompleteRide={riderActions.openDropoffConfirm}
              tripStops={route.tripStops}
              tripStopsLoading={route.tripStopsLoading}
              actionError={riderActions.actionError}
            />
          </View>
          <View style={{ flex: 1, display: activeTab === 'driver' ? 'flex' : 'none' }}>
            <DriverTab
              driverName={driverName}
              driverBadge={copy.driverBadge}
              callNumber={driverCallNumber(trip)}
              whatsappNumber={trip.contactNumber}
              vehicle={trip.userVehicle}
              onOpenChat={onOpenChat}
            />
          </View>
          <View style={{ flex: 1, display: activeTab === 'summary' ? 'flex' : 'none' }}>
            <SummaryTab inquiry={inquiry} />
          </View>
        </View>

        {/* Action bar (pinned): progress on the left, cancel-seat on the
            right — still allowed while the trip runs, behind a confirmation. */}
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
              {copy.progressTitle}
            </AppText>
            <AppText muted variant="caption" numberOfLines={1}>
              {progressMeta}
            </AppText>
          </View>
          {availableActions.includes(TripInquiryStatus.CANCELLED) ? (
            <AppButton title="Cancel seat" variant="danger" fullWidth={false} onPress={riderActions.openCancelConfirm} />
          ) : null}
        </View>
      </View>

      <RiderConfirmSheet inquiry={inquiry} riderActions={riderActions} />

      {/* Chat — modal, opened from the Driver tab's Chat button, reusing the
          exact same ChatModalSheet component the driver screen's own cockpit
          uses (wrapping ChatPanel, untouched). ChatModalSheet's props are
          named for a per-rider pickup/dropoff subtitle on the driver's
          screen; reused here for a vehicle-name/plate subtitle instead — no
          internals changed. */}
      <ChatModalSheet
        visible={chatOpen}
        onClose={onCloseChat}
        tripInquiryId={inquiry.id}
        riderName={driverName}
        pickupLabel={vehicleName}
        dropoffLabel={vehiclePlate}
      />
    </>
  );
}
