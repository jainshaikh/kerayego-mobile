import { useState } from 'react';
import { View } from 'react-native';

import { AppButton, AppSheet, AppText, StatusBadge } from '../../../components/ui';
import { useTheme } from '../../../theme';
import type { TripManifest } from '../../../api/trips.api';
import type { TripDetail } from '../../../types/api.types';
import { TripStatus, tripStatusMeta, TripEventType } from '../../../types/enums';
import { LiveTripMap, type LiveTripMapProps, type LiveTripStop } from '../../liveRide/components/LiveTripMap';
import { ChatModalSheet } from '../../liveRide/components/ChatModalSheet';
import { openMapsNavigation } from '../../liveRide/openMapsNavigation';
import type { DriverStopProgress } from './useDriverStopProgress';
import type { CockpitRider } from './stopProgress';
import type { NoShowContext } from './noShow';
import type { DriverLocationWatch } from './useDriverLocationWatch';
import type { DriverBackgroundLocation } from '../../liveRide/backgroundLocation/useDriverBackgroundLocation';
import { BackgroundLocationNotice } from './BackgroundLocationNotice';
import type { DriverTripActions } from './useDriverTripActions';
import type { DriverChatInbox } from './useDriverChatInbox';
import type { OfflineTripQueue } from '../offlineSync';
import { OfflineQueueNotice } from '../components/OfflineQueueNotice';
import { RidersTab } from './RidersTab';
import { DetailsTab } from './DetailsTab';
import { RouteOverview } from './RouteOverview';
import { LegPanel, type CockpitSheet } from './LegPanel';
import { useLegRoute } from './useLegRoute';
import { useAutoArrival } from './useAutoArrival';
import { useRiderLocationPins } from './useRiderLocationPins';
import { hasRidersAwaitingPickup } from './riderLocations';
import { formatAgo } from '../../trip-inquiries/riderLiveTrip/riderTripState';

interface DriverLiveCockpitProps {
  trip: TripDetail;
  manifest: TripManifest | undefined;
  manifestLoading: boolean;
  // The manifest request failed with nothing cached to fall back on.
  manifestFailed: boolean;
  onRetryManifest: () => void;
  effectiveInProgress: boolean;
  effectiveCompleted: boolean;
  isConnected: boolean;
  stopProgress: DriverStopProgress;
  location: DriverLocationWatch;
  backgroundLocation: DriverBackgroundLocation;
  actions: DriverTripActions;
  chat: DriverChatInbox;
  offlineQueue: OfflineTripQueue;
}

// The driver's day-of-execution cockpit, leg by leg: ride header, a map that
// only ever shows the current leg (the driver, the stop they're heading to,
// and the route between them — or just that stop once they've arrived), and
// the leg panel underneath, which walks them through the stop — navigate,
// arrive, verify its riders, start the next leg (see legState.ts). The whole
// route, every rider and the trip details are sheets off the panel. Rendered
// by my-trips/[id].tsx once the trip is in progress or has just completed.
export function DriverLiveCockpit({
  trip,
  manifest,
  manifestLoading,
  manifestFailed,
  onRetryManifest,
  effectiveInProgress,
  effectiveCompleted,
  isConnected,
  stopProgress,
  location,
  backgroundLocation,
  actions,
  chat,
  offlineQueue,
}: DriverLiveCockpitProps) {
  const { colors, spacing } = useTheme();
  const [sheet, setSheet] = useState<CockpitSheet | null>(null);

  const { mergedRiders, leg, canConfirmArrival, serverClock } = stopProgress;
  const { currentPosition, locationDenied, lastLocationUpdateAt } = location;
  const live = effectiveInProgress && !effectiveCompleted;
  const current = live ? leg.current : null;
  const navigating = live && leg.phase === 'navigating' && !!current;
  const driverPoint = live && currentPosition ? { lat: currentPosition.lat, lng: currentPosition.lng } : null;

  // The current leg's route — only while driving it; navigation pauses at the stop.
  const legRoute = useLegRoute(
    navigating && current ? { id: current.stop.id, lat: current.stop.lat, lng: current.stop.lng } : null,
    navigating ? driverPoint : null,
  );

  // Arrival is also marked automatically once the driver has stopped at the
  // stop (useAutoArrival) — the same ARRIVED the Arrived button sends.
  useAutoArrival(
    navigating && current && !locationDenied
      ? { id: current.stop.id, lat: current.stop.lat, lng: current.stop.lng }
      : null,
    currentPosition,
    (stopId) => {
      if (leg.current?.stop.id === stopId) actions.handleArrived(leg.current.stop, currentPosition, 'auto');
    },
  );

  // Everything the per-rider no-show gate needs beyond the rider. serverClock
  // is null on an older backend, which keeps the no-show action hidden.
  const noShowContext: NoShowContext = {
    routeStops: manifest?.routeStops ?? [],
    serverClock,
    queuedArrivalStopIds: actions.queuedArrivalStopIds,
  };
  // Only the backend that times no-shows also leaves them out of End's
  // auto-completion; an older one completes every untapped rider.
  const noShowSupported = serverClock !== null;
  const noShowCount = mergedRiders.filter((rider) => rider.noShow).length;

  // Ride header: "On Trip" reads oddly once the ride has actually ended, so
  // the header badge swaps to the trip's real completed state — tripStatusMeta
  // has no "On Trip"/accent entry (it's a display label this design
  // introduces only for the active state), so it's computed directly here
  // instead of reused from tripStatusMeta.
  const rideBadge = effectiveCompleted
    ? { label: tripStatusMeta[TripStatus.COMPLETED].label, tone: tripStatusMeta[TripStatus.COMPLETED].tone }
    : { label: 'On Trip', tone: 'accent' as const };

  // Strictly the current leg: just the stop being driven to (or stood at) —
  // every other stop lives in the Route sheet.
  const mapStops: LiveTripStop[] = current ? [{ ...current.stop, sequence: current.index + 1, status: 'selected' }] : [];
  // Driving a leg: frame the driver and the stop, and follow them. At the
  // stop: just the stop. Route done: just the driver.
  let mapFocus: LiveTripMapProps['focus'];
  if (current) {
    const stopPoint = { lat: current.stop.lat, lng: current.stop.lng };
    mapFocus = navigating
      ? { key: `go:${current.stop.id}`, points: driverPoint ? [driverPoint, stopPoint] : [stopPoint], follow: true }
      : { key: `at:${current.stop.id}`, points: [stopPoint], follow: false };
  } else if (driverPoint) {
    mapFocus = { key: 'done', points: [driverPoint], follow: true };
  }

  // Riders sharing their location until pickup — a pin each, polled while
  // any rider still waits to be picked up.
  const sharedRiders = useRiderLocationPins({
    tripId: trip.id,
    tripStatus: trip.status,
    departureAt: trip.departureAt,
    ridersAwaitingPickup: live && hasRidersAwaitingPickup(mergedRiders),
  });
  const riderPins = sharedRiders.riders.map((rider) => ({
    id: rider.tripInquiryId,
    lat: rider.lat,
    lng: rider.lng,
    label: `${rider.riderName} · ${formatAgo(sharedRiders.receivedAt - Date.parse(rider.at))}`,
  }));

  const doneStopsCount = leg.stops.filter((stop) => stop.status === 'done' || stop.status === 'skipped').length;
  const totalStopsCount = leg.stops.length;
  const chatRider = chat.chatTarget ? mergedRiders.find((r) => r.id === chat.chatTarget?.id) : undefined;

  // The Riders sheet's one action: a no-show rider has no pickup yet, so this
  // sends PICKUP — reversing it.
  const handleToggleRiderStatus = (rider: CockpitRider) => {
    actions.handleRiderEvent(rider.id, rider.pickupConfirmedAt ? TripEventType.DROPOFF : TripEventType.PICKUP);
  };
  // A sheet can't open another on top of itself, so chat from the Riders
  // sheet closes it first.
  const openChatFromSheet = (riderId: string, riderName: string) => {
    setSheet(null);
    chat.openChat(riderId, riderName);
  };

  return (
    <>
      <View style={{ flex: 1 }}>
        {/* Ride header — fixed. */}
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
              {manifest ? `Active ride · ${doneStopsCount} of ${totalStopsCount} stops done` : 'Active ride'}
            </AppText>
            <AppText variant="title" numberOfLines={1} style={{ textTransform: 'capitalize' }}>
              {trip.originCity} → {trip.destinationCity}
            </AppText>
          </View>
          <StatusBadge label={rideBadge.label} tone={rideBadge.tone} />
        </View>

        <OfflineQueueNotice queue={offlineQueue} variant="bar" />
        {/* Only while the ride is live — nothing to share once it's over. */}
        {live ? <BackgroundLocationNotice backgroundLocation={backgroundLocation} /> : null}

        {/* The map gets every bit of space the leg panel doesn't use —
            nothing is drawn over it. */}
        <View style={{ flex: 1 }}>
          <LiveTripMap
            stops={mapStops}
            driverPosition={driverPoint}
            isConnected={isConnected}
            lastUpdateAt={lastLocationUpdateAt}
            routePolyline={navigating ? (legRoute.polyline ?? undefined) : undefined}
            focus={mapFocus}
            riderPins={riderPins}
          />
        </View>

        {actions.actionError ? (
          <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }}>
            <AppText color={colors.danger} variant="caption">
              {actions.actionError}
            </AppText>
          </View>
        ) : null}

        <LegPanel
          leg={leg}
          // Without a manifest there is no route yet — never read that as
          // "every stop done".
          routeStatus={manifest ? 'ready' : manifestFailed ? 'failed' : 'loading'}
          onRetryRoute={onRetryManifest}
          totalStops={totalStopsCount}
          completed={effectiveCompleted}
          locationDenied={locationDenied}
          canConfirmArrival={canConfirmArrival}
          route={legRoute}
          serverClock={serverClock}
          noShowContext={noShowContext}
          unreadCounts={chat.unreadCounts}
          arrivalPending={!!current && actions.isArrivalPending(current.stop.id)}
          departurePending={!!current && actions.isDeparturePending(current.stop.id)}
          isRiderPending={actions.isRiderActionPending}
          onNavigate={() => current && openMapsNavigation(current.stop)}
          onArrive={() => current && actions.handleArrived(current.stop, currentPosition)}
          onStartNextLeg={() => current && actions.handleDeparted(current.stop)}
          onEndRide={() => actions.setEndConfirming(true)}
          onPickedUp={(rider) => actions.handleRiderEvent(rider.id, TripEventType.PICKUP)}
          onDroppedOff={(rider) => actions.handleRiderEvent(rider.id, TripEventType.DROPOFF)}
          onNoShow={actions.openNoShow}
          onChat={(rider) => chat.openChat(rider.id, rider.user.name)}
          onOpenSheet={setSheet}
        />
      </View>

      <AppSheet
        visible={sheet === 'route'}
        onClose={() => setSheet(null)}
        title="Route"
        subtitle={`${doneStopsCount} of ${totalStopsCount} stops done`}
      >
        <RouteOverview stops={leg.stops} />
      </AppSheet>

      {/* Every rider at once, for anything out of route order (an early
          drop-off, say). No-shows are marked at the stop itself, in the leg
          panel — hidden here (no clock) so this sheet never has to stack the
          no-show confirmation on top of itself. */}
      <AppSheet visible={sheet === 'riders'} onClose={() => setSheet(null)} title="Riders">
        <RidersTab
          loading={manifestLoading}
          riders={mergedRiders}
          noShowContext={{ ...noShowContext, serverClock: null }}
          visible={sheet === 'riders'}
          isRiderPending={actions.isRiderActionPending}
          unreadCounts={chat.unreadCounts}
          onToggleRiderStatus={handleToggleRiderStatus}
          onNoShow={() => {}}
          onChat={openChatFromSheet}
        />
      </AppSheet>

      <AppSheet visible={sheet === 'details'} onClose={() => setSheet(null)} title="Trip details">
        <DetailsTab trip={trip} manifest={manifest} riders={mergedRiders} />
      </AppSheet>

      {/* End-ride confirmation sheet — the ride's only End trigger/confirm-flow. */}
      <AppSheet visible={actions.endConfirming} onClose={() => actions.setEndConfirming(false)} title="End this ride?">
        <AppText muted variant="caption" style={{ marginBottom: spacing.md }}>
          Any rider you haven&apos;t tapped pickup/drop-off for will be marked as completed automatically.
          {noShowSupported
            ? noShowCount > 0
              ? ` ${noShowCount} rider${noShowCount !== 1 ? 's' : ''} marked as no-show won't be counted as completed.`
              : " Riders marked as no-show aren't counted as completed."
            : null}
        </AppText>
        {/* End syncs this trip's queued actions first; the warning shows only
            when some still couldn't go — ending now queues End behind them. */}
        {actions.endSyncing ? (
          <AppText muted variant="caption" style={{ marginBottom: spacing.md }}>
            Syncing your queued actions before ending…
          </AppText>
        ) : actions.endUnsyncedCount > 0 ? (
          <AppText color={colors.warning} variant="caption" style={{ marginBottom: spacing.md }}>
            {actions.endUnsyncedCount} earlier action{actions.endUnsyncedCount !== 1 ? 's' : ''} still{' '}
            {actions.endUnsyncedCount !== 1 ? "haven't" : "hasn't"} synced. If you end now, the ride ends once{' '}
            {actions.endUnsyncedCount !== 1 ? 'they sync' : 'it syncs'}, in order, when you&apos;re back online.
          </AppText>
        ) : null}
        {actions.actionError ? (
          <AppText color={colors.danger} variant="caption" style={{ marginBottom: spacing.md }}>
            {actions.actionError}
          </AppText>
        ) : null}
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <AppButton title="Not yet" variant="secondary" onPress={() => actions.setEndConfirming(false)} />
          </View>
          <View style={{ flex: 1 }}>
            <AppButton
              title={actions.endUnsyncedCount > 0 ? 'End anyway' : 'End ride'}
              variant="danger"
              loading={actions.endTripPending || actions.endSyncing}
              onPress={actions.handleEnd}
            />
          </View>
        </View>
      </AppSheet>

      {/* "Didn't show" confirmation — opened from a rider's row in the leg
          panel once the five-minute wait at their pickup stop is over. A
          refusal (e.g. the server's own wait not over yet) stays here, in the
          sheet. */}
      <AppSheet
        visible={actions.noShowOpen}
        onClose={actions.closeNoShow}
        title={actions.noShowTarget ? `Mark ${actions.noShowTarget.riderName} as a no-show?` : undefined}
      >
        <AppText muted variant="caption" style={{ marginBottom: spacing.md }}>
          {actions.noShowTarget?.riderName ?? 'The rider'} will be notified that you marked them as a no-show
          {actions.noShowTarget?.stopLabel ? ` at ${actions.noShowTarget.stopLabel}` : ''}, and won&apos;t be counted as
          a completed rider. If they turn up after all, you can still mark them picked up.
        </AppText>
        {actions.noShowError ? (
          <AppText color={colors.danger} variant="caption" style={{ marginBottom: spacing.md }}>
            {actions.noShowError}
          </AppText>
        ) : null}
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <AppButton title="Not now" variant="secondary" onPress={actions.closeNoShow} />
          </View>
          <View style={{ flex: 1 }}>
            <AppButton
              title="Mark no-show"
              variant="danger"
              loading={!!actions.noShowTarget && actions.isRiderActionPending(actions.noShowTarget.riderId)}
              onPress={() => actions.confirmNoShow(currentPosition)}
            />
          </View>
        </View>
      </AppSheet>

      {/* Chat — always mounted (visible toggled) so ChatModalSheet/ChatPanel
          never has to remount on every open/close. */}
      <ChatModalSheet
        visible={!!chat.chatTarget}
        onClose={chat.closeChat}
        tripInquiryId={chat.chatTarget?.id ?? ''}
        riderName={chat.chatTarget?.name ?? ''}
        pickupLabel={chatRider?.pickupStop?.label ?? '—'}
        dropoffLabel={chatRider?.dropoffStop?.label ?? '—'}
      />
    </>
  );
}
