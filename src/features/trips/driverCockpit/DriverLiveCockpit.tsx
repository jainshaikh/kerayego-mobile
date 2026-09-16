import { useState } from 'react';
import { Modal, View } from 'react-native';

import { AppButton, AppText, StatusBadge, TabBar, type TabBarItem } from '../../../components/ui';
import { useTheme } from '../../../theme';
import type { ManifestRider, TripManifest } from '../../../api/trips.api';
import type { TripDetail } from '../../../types/api.types';
import { TripStatus, tripStatusMeta, TripEventType } from '../../../types/enums';
import { formatDistance } from '../../../utils/format';
import { LiveTripMap, type LiveTripStop } from '../../liveRide/components/LiveTripMap';
import { ChatModalSheet } from '../../liveRide/components/ChatModalSheet';
import { openMapsNavigation } from '../../liveRide/openMapsNavigation';
import { ARRIVAL_RADIUS_METERS, type DriverStopProgress } from './useDriverStopProgress';
import type { DriverLocationWatch } from './useDriverLocationWatch';
import type { DriverTripActions } from './useDriverTripActions';
import type { DriverChatInbox } from './useDriverChatInbox';
import type { OfflineTripQueue } from '../offlineSync';
import { StopsTab } from './StopsTab';
import { RidersTab } from './RidersTab';
import { DetailsTab } from './DetailsTab';

type DriverTab = 'stops' | 'riders' | 'details';

// Module-level constant — stable identity across renders, no need to
// recreate this array on every render just to pass it to TabBar.
const DRIVER_TABS: TabBarItem[] = [
  { key: 'stops', label: 'Stops' },
  { key: 'riders', label: 'Riders' },
  { key: 'details', label: 'Details' },
];

interface DriverLiveCockpitProps {
  trip: TripDetail;
  manifest: TripManifest | undefined;
  manifestLoading: boolean;
  effectiveInProgress: boolean;
  effectiveCompleted: boolean;
  isConnected: boolean;
  stopProgress: DriverStopProgress;
  location: DriverLocationWatch;
  actions: DriverTripActions;
  chat: DriverChatInbox;
  offlineQueue: OfflineTripQueue;
}

// The driver's day-of-execution cockpit (design spec, active-ride-driver):
// ride header, map + next-stop overlay, Stops/Riders/Details tabs, and the
// pinned End-ride action bar. Rendered by my-trips/[id].tsx once the trip is
// in progress or has just completed.
export function DriverLiveCockpit({
  trip,
  manifest,
  manifestLoading,
  effectiveInProgress,
  effectiveCompleted,
  isConnected,
  stopProgress,
  location,
  actions,
  chat,
  offlineQueue,
}: DriverLiveCockpitProps) {
  const { colors, spacing, radii } = useTheme();
  const [activeTab, setActiveTab] = useState<DriverTab>('stops');

  const {
    mergedRiders,
    stopResolutions,
    nextStop,
    nextStopDistanceM,
    canConfirmArrival,
    selectedStopId,
    setSelectedStopId,
    previewStop,
    routeDirections,
  } = stopProgress;
  const { currentPosition, locationDenied, lastLocationUpdateAt } = location;

  const nextStopArrived = !!nextStop && actions.arrivedStopIds.has(nextStop.id);

  // Ride header: "On Trip" reads oddly once the ride has actually ended, so
  // the header badge swaps to the trip's real completed state — tripStatusMeta
  // has no "On Trip"/accent entry (it's a display label this design
  // introduces only for the active state), so it's computed directly here
  // instead of reused from tripStatusMeta.
  const rideBadge = effectiveCompleted
    ? { label: tripStatusMeta[TripStatus.COMPLETED].label, tone: tripStatusMeta[TripStatus.COMPLETED].tone }
    : { label: 'On Trip', tone: 'accent' as const };

  // Map pins: reached takes precedence over selected — a stop the driver has
  // previewed (selectedStopId) that turns out to already be fully resolved
  // still renders as 'reached', never 'selected'.
  const mapStops: LiveTripStop[] = stopResolutions.map(({ stop, resolved }, index) => ({
    ...stop,
    sequence: index + 1,
    status: resolved ? 'reached' : stop.id === selectedStopId ? 'selected' : 'upcoming',
  }));

  const doneStopsCount = stopResolutions.filter((r) => r.resolved).length;
  const totalStopsCount = manifest?.routeStops.length ?? 0;

  // Map's next-stop banner: caption differs depending on whether the
  // currently previewed stop is the real next stop or one the driver
  // selected deliberately; distance/duration come from the route-directions
  // fetch when it has resolved.
  const previewIsNextStop = !!nextStop && !!previewStop && previewStop.id === nextStop.id;
  const routeDistanceEta = routeDirections
    ? `${formatDistance(routeDirections.distanceKm)} · ${Math.round(routeDirections.durationMinutes)} min`
    : null;
  const navCaption = previewStop
    ? `${previewIsNextStop ? 'Next stop' : 'Selected stop'}${routeDistanceEta ? ` · ${routeDistanceEta}` : ''}`
    : '';

  const chatRider = chat.chatTarget ? mergedRiders.find((r) => r.id === chat.chatTarget?.id) : undefined;

  const handleToggleRiderStatus = (rider: ManifestRider) => {
    actions.handleRiderEvent(rider.id, rider.pickupConfirmedAt ? TripEventType.DROPOFF : TripEventType.PICKUP);
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
              Active ride · today
            </AppText>
            <AppText variant="title" numberOfLines={1} style={{ textTransform: 'capitalize' }}>
              {trip.originCity} → {trip.destinationCity}
            </AppText>
          </View>
          <StatusBadge label={rideBadge.label} tone={rideBadge.tone} />
        </View>

        {offlineQueue.pendingCount > 0 ? (
          <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.surfaceAlt }}>
            <AppText variant="caption">
              {offlineQueue.flushing
                ? 'Syncing…'
                : `${offlineQueue.pendingCount} action${offlineQueue.pendingCount !== 1 ? 's' : ''} queued — no connection yet. They'll sync automatically once you're back online.`}
            </AppText>
          </View>
        ) : null}

        {/* Map section: pinned, ~45% of the remaining height (never
            scrolled), plus its bottom-anchored next-stop banner. */}
        <View style={{ flex: 0.45, position: 'relative' }}>
          <LiveTripMap
            stops={mapStops}
            driverPosition={effectiveInProgress && currentPosition ? { lat: currentPosition.lat, lng: currentPosition.lng } : null}
            isConnected={isConnected}
            lastUpdateAt={lastLocationUpdateAt}
            routePolyline={effectiveInProgress ? routeDirections?.polyline : undefined}
            onSelectStop={(stopId) => setSelectedStopId(stopId)}
          />

          <View
            style={{
              position: 'absolute',
              left: spacing.md,
              right: spacing.md,
              bottom: spacing.md,
              backgroundColor: colors.surface,
              borderRadius: radii.card,
              padding: spacing.md,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            {effectiveCompleted ? (
              <AppText variant="label">Trip completed</AppText>
            ) : previewStop ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <AppText muted variant="caption" numberOfLines={1}>
                    {navCaption}
                  </AppText>
                  <AppText variant="subtitle" numberOfLines={1}>
                    {previewStop.type === 'PICKUP' ? 'Pickup' : 'Dropoff'} · {previewStop.label}
                  </AppText>
                </View>
                <AppButton
                  title="Navigate"
                  variant="secondary"
                  fullWidth={false}
                  onPress={() => openMapsNavigation(previewStop)}
                />
              </View>
            ) : null}

            {/* Reached control — its own element, tied strictly to the real
                nextStop, never previewStop/selectedStopId. */}
            {!effectiveCompleted && nextStop ? (
              <View style={{ marginTop: previewStop ? spacing.sm : 0 }}>
                {locationDenied ? (
                  <AppText muted variant="caption">
                    Location access is needed to confirm arrival at this stop. Enable location permission for this app
                    in your device settings.
                  </AppText>
                ) : (
                  <>
                    <AppButton
                      title={nextStopArrived ? 'Already reached' : 'Reached'}
                      loading={actions.recordEventPending}
                      disabled={nextStopArrived || !canConfirmArrival}
                      onPress={() => actions.handleArrived(nextStop, currentPosition)}
                    />
                    {!nextStopArrived && !canConfirmArrival ? (
                      <AppText muted variant="caption" style={{ marginTop: spacing.xs }}>
                        Get within {ARRIVAL_RADIUS_METERS}m of this stop to confirm arrival.
                      </AppText>
                    ) : null}
                  </>
                )}
              </View>
            ) : null}
          </View>
        </View>

        {/* Tabs + tab content: pinned tab row, independently scrolling content. */}
        <View style={{ flex: 0.55 }}>
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm }}>
            <TabBar tabs={DRIVER_TABS} activeKey={activeTab} onChange={(key) => setActiveTab(key as DriverTab)} />
          </View>
          <View style={{ flex: 1 }}>
            {/* All three stay mounted (display toggled, not conditionally
                rendered) so switching tabs never resets scroll position. */}
            <View style={{ flex: 1, display: activeTab === 'stops' ? 'flex' : 'none' }}>
              <StopsTab
                loading={manifestLoading}
                stopResolutions={stopResolutions}
                nextStop={nextStop}
                nextStopDistanceM={nextStopDistanceM}
                selectedStopId={selectedStopId}
                nextStopArrived={nextStopArrived}
                canConfirmArrival={canConfirmArrival}
                arrivedPending={actions.recordEventPending}
                onConfirmArrival={(stop) => actions.handleArrived(stop, currentPosition)}
                onSelectStop={setSelectedStopId}
              />
            </View>
            <View style={{ flex: 1, display: activeTab === 'riders' ? 'flex' : 'none' }}>
              <RidersTab
                loading={manifestLoading}
                riders={mergedRiders}
                noShowIds={actions.noShowIds}
                pending={actions.recordEventPending}
                unreadCounts={chat.unreadCounts}
                onToggleRiderStatus={handleToggleRiderStatus}
                onChat={chat.openChat}
              />
            </View>
            <View style={{ flex: 1, display: activeTab === 'details' ? 'flex' : 'none' }}>
              <DetailsTab trip={trip} manifest={manifest} riders={mergedRiders} />
            </View>
          </View>
        </View>

        {actions.actionError ? (
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>
            <AppText color={colors.danger} variant="caption">
              {actions.actionError}
            </AppText>
          </View>
        ) : null}

        {/* Action bar (design spec): pinned. The single "End ride" trigger —
            always present/reachable, never swapped for a per-stop action. */}
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
            <AppText variant="label">
              {doneStopsCount} of {totalStopsCount} stops done
            </AppText>
            <AppText muted variant="caption" numberOfLines={1} style={{ textTransform: 'capitalize' }}>
              Arriving {trip.destinationCity}
            </AppText>
          </View>
          <AppButton
            title="End ride"
            variant="danger"
            fullWidth={false}
            disabled={effectiveCompleted}
            onPress={() => actions.setEndConfirming(true)}
          />
        </View>
      </View>

      {/* End-ride confirmation sheet — the ride's only End trigger/confirm-flow. */}
      <Modal visible={actions.endConfirming} animationType="slide" transparent onRequestClose={() => actions.setEndConfirming(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: spacing.lg }}>
            <AppText variant="subtitle" style={{ marginBottom: spacing.xs }}>
              End this ride?
            </AppText>
            <AppText muted variant="caption" style={{ marginBottom: spacing.md }}>
              Any rider you haven&apos;t tapped pickup/drop-off for will be marked as completed automatically.
            </AppText>
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
                <AppButton title="End ride" variant="danger" loading={actions.endTripPending} onPress={actions.handleEnd} />
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Chat — modal sheet opened per-rider from the Riders tab, always
          mounted (visible toggled) so ChatModalSheet/ChatPanel never has to
          remount on every open/close. */}
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
