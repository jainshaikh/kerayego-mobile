import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Image } from 'expo-image';

import { AppButton, AppCard, AppInput, AppText, Row, StatusBadge } from '../../../components/ui';
import { RatingSummaryBadge } from '../../../components/reviews/RatingSummaryBadge';
import { useTheme } from '../../../theme';
import type { TripDetail } from '../../../types/api.types';
import type { TripInquiry } from '../../../api/trip-inquiries.api';
import type { useUpdateTripInquiryStatus } from '../../trip-inquiries/queries';
import { TripInquiryStatus, TripStatus, tripInquiryStatusMeta, tripPosterActions, tripStatusMeta } from '../../../types/enums';
import { formatDate, formatPrice, titleCase } from '../../../utils/format';
import type { DriverTripActions } from './useDriverTripActions';
import type { OfflineTripQueue } from '../offlineSync';

interface DriverPostedTripViewProps {
  trip: TripDetail;
  effectiveInProgress: boolean;
  effectiveCompleted: boolean;
  inquiries: TripInquiry[];
  inquiriesLoading: boolean;
  updateInquiryStatus: ReturnType<typeof useUpdateTripInquiryStatus>;
  driverActions: DriverTripActions;
  offlineQueue: OfflineTripQueue;
}

// The driver's view of a trip before it goes live: trip summary, vehicle,
// incoming seat requests inbox (accept/decline), and the Start/Cancel
// actions. Rendered by my-trips/[id].tsx while the trip hasn't started (or
// after it has been rejected/cancelled).
export function DriverPostedTripView({
  trip,
  effectiveInProgress,
  effectiveCompleted,
  inquiries,
  inquiriesLoading,
  updateInquiryStatus,
  driverActions,
  offlineQueue,
}: DriverPostedTripViewProps) {
  const { colors, spacing } = useTheme();
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineNote, setDeclineNote] = useState('');

  const statusMeta = tripStatusMeta[trip.status];
  const posterActions = effectiveCompleted ? [] : effectiveInProgress ? ['end' as const] : tripPosterActions(trip.status);

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <AppText variant="title" style={{ textTransform: 'capitalize', flex: 1, marginRight: spacing.md }}>
          {trip.originCity} → {trip.destinationCity}
        </AppText>
        <StatusBadge label={statusMeta.label} tone={statusMeta.tone} />
      </View>

      {offlineQueue.pendingCount > 0 ? (
        <AppCard style={{ marginTop: spacing.md, backgroundColor: colors.surfaceAlt }}>
          <AppText variant="caption">
            {offlineQueue.flushing
              ? 'Syncing…'
              : `${offlineQueue.pendingCount} action${offlineQueue.pendingCount !== 1 ? 's' : ''} queued — no connection yet. They'll sync automatically once you're back online.`}
          </AppText>
        </AppCard>
      ) : null}

      {trip.rejectionReason ? (
        <AppCard style={{ marginTop: spacing.lg }}>
          <AppText variant="label" color={colors.danger}>
            Rejection reason
          </AppText>
          <AppText muted style={{ marginTop: spacing.xs }}>
            {trip.rejectionReason}
          </AppText>
        </AppCard>
      ) : null}
      {trip.cancelReason ? (
        <AppCard style={{ marginTop: spacing.lg }}>
          <AppText variant="label">Cancellation reason</AppText>
          <AppText muted style={{ marginTop: spacing.xs }}>
            {trip.cancelReason}
          </AppText>
        </AppCard>
      ) : null}

      <AppCard style={{ marginTop: spacing.lg }}>
        <Row label="Departure" value={formatDate(trip.departureAt)} />
        <Row label="Pickup point" value={trip.pickupPoint} />
        {trip.dropoffPoint ? <Row label="Drop-off point" value={trip.dropoffPoint} /> : null}
        <Row label="Available seats" value={String(trip.availableSeats)} />
        <Row label="Price / seat" value={formatPrice(trip.pricePerSeat)} />
        <Row label="Contact number" value={trip.contactNumber} />
      </AppCard>

      <AppCard style={{ marginTop: spacing.lg }}>
        <AppText variant="label" style={{ marginBottom: spacing.sm }}>
          Vehicle
        </AppText>
        {trip.userVehicle.images.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }}>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {trip.userVehicle.images.map((image) => (
                <View
                  key={image.id}
                  style={{ width: 112, height: 80, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.surfaceAlt }}
                >
                  <Image source={{ uri: image.url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                </View>
              ))}
            </View>
          </ScrollView>
        ) : null}
        <Row label="Vehicle" value={`${titleCase(trip.userVehicle.make)} ${titleCase(trip.userVehicle.model)}`} />
        <Row label="Plate" value={trip.userVehicle.plateNumber} />
      </AppCard>

      {trip.notes ? (
        <AppCard style={{ marginTop: spacing.lg }}>
          <AppText variant="label">Notes</AppText>
          <AppText muted style={{ marginTop: spacing.xs }}>
            {trip.notes}
          </AppText>
        </AppCard>
      ) : null}

      {trip.status === TripStatus.ACTIVE && !effectiveInProgress ? (
        <AppCard style={{ marginTop: spacing.lg }}>
          <AppText variant="label" style={{ marginBottom: spacing.sm }}>
            Incoming requests
          </AppText>
          {inquiriesLoading ? (
            <AppText muted variant="caption">
              Loading…
            </AppText>
          ) : !inquiries.length ? (
            <AppText muted variant="caption">
              No requests yet — riders who ask for a seat will show up here.
            </AppText>
          ) : (
            inquiries.map((inquiry) => (
              <View
                key={inquiry.id}
                style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, marginTop: spacing.sm }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <AppText variant="caption" style={{ flex: 1, marginRight: spacing.sm }}>
                    {inquiry.user.name} · {inquiry.requestedSeats} seat{inquiry.requestedSeats !== 1 ? 's' : ''}
                  </AppText>
                  <StatusBadge
                    label={tripInquiryStatusMeta[inquiry.status].label}
                    tone={tripInquiryStatusMeta[inquiry.status].tone}
                  />
                </View>
                <RatingSummaryBadge subjectType="USER" subjectId={inquiry.user.id} size="sm" />
                {inquiry.message ? (
                  <AppText muted variant="caption" style={{ marginTop: spacing.xs }}>
                    &ldquo;{inquiry.message}&rdquo;
                  </AppText>
                ) : null}

                {inquiry.status === 'PENDING' && decliningId !== inquiry.id ? (
                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                    <View style={{ flex: 1 }}>
                      <AppButton
                        title="Accept"
                        loading={updateInquiryStatus.isPending}
                        onPress={() =>
                          updateInquiryStatus.mutate({ id: inquiry.id, data: { newStatus: TripInquiryStatus.ACCEPTED } })
                        }
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <AppButton
                        title="Decline"
                        variant="secondary"
                        onPress={() => {
                          setDeclineNote('');
                          setDecliningId(inquiry.id);
                        }}
                      />
                    </View>
                  </View>
                ) : null}

                {decliningId === inquiry.id ? (
                  <View style={{ marginTop: spacing.sm }}>
                    <AppInput placeholder="Optional note for the rider" value={declineNote} onChangeText={setDeclineNote} />
                    <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                      <View style={{ flex: 1 }}>
                        <AppButton title="Keep pending" variant="secondary" onPress={() => setDecliningId(null)} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <AppButton
                          title="Confirm decline"
                          variant="danger"
                          loading={updateInquiryStatus.isPending}
                          onPress={async () => {
                            await updateInquiryStatus.mutateAsync({
                              id: inquiry.id,
                              data: { newStatus: TripInquiryStatus.REJECTED, note: declineNote || undefined },
                            });
                            setDecliningId(null);
                          }}
                        />
                      </View>
                    </View>
                  </View>
                ) : null}
              </View>
            ))
          )}
        </AppCard>
      ) : null}

      {driverActions.actionError ? (
        <AppText color={colors.danger} style={{ marginTop: spacing.md }}>
          {driverActions.actionError}
        </AppText>
      ) : null}

      {posterActions.includes('start') ? (
        driverActions.startConfirming ? (
          <AppCard style={{ marginTop: spacing.xl }}>
            <AppText variant="label">Start this trip?</AppText>
            <AppText muted variant="caption" style={{ marginTop: spacing.xs }}>
              This locks in your currently accepted riders as the manifest and removes the trip from search.
            </AppText>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <AppButton title="Not yet" variant="secondary" onPress={() => driverActions.setStartConfirming(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <AppButton title="Start trip" loading={driverActions.startTripPending} onPress={driverActions.handleStart} />
              </View>
            </View>
          </AppCard>
        ) : (
          <AppButton title="Start trip" onPress={() => driverActions.setStartConfirming(true)} style={{ marginTop: spacing.xl }} />
        )
      ) : null}

      {posterActions.includes('cancel') ? (
        <AppButton
          title="Cancel trip"
          variant="danger"
          loading={driverActions.cancelTripPending}
          onPress={driverActions.handleCancel}
          style={{ marginTop: spacing.md }}
        />
      ) : null}
    </ScrollView>
  );
}
