import { View } from 'react-native';
import { AppButton, AppSheet, AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';
import type { TripInquiry } from '../../../api/trip-inquiries.api';
import { TripEventType } from '../../../types/enums';
import { confirmSheetCopy } from './riderTripState';
import { ownDropoffPoint } from './tripDisplay';
import type { RiderTripActions } from './useRiderTripActions';

interface RiderConfirmSheetProps {
  inquiry: TripInquiry;
  riderActions: RiderTripActions;
}

// The confirmation for the rider's two irreversible actions — cancelling
// (their request or confirmed seat) and reporting their own drop-off. A
// refusal (e.g. the trip already departed, or the driver just marked them a
// no-show) stays here, in the sheet; a drop-off saved offline closes it.
export function RiderConfirmSheet({ inquiry, riderActions }: RiderConfirmSheetProps) {
  const { colors, spacing } = useTheme();
  const { confirmKind, confirmOpen, confirmError, closeConfirm } = riderActions;
  const copy = confirmKind
    ? confirmSheetCopy(confirmKind, {
        inquiryStatus: inquiry.status,
        tripStatus: inquiry.trip.status,
        driverName: inquiry.trip.postedBy.name,
        dropoffLabel: ownDropoffPoint(inquiry).label,
      })
    : null;
  const confirming =
    confirmKind === 'cancel' ? riderActions.updateStatusPending : riderActions.actioningType === TripEventType.DROPOFF;

  return (
    <AppSheet visible={confirmOpen} onClose={closeConfirm} title={copy?.title}>
      <AppText muted variant="caption" style={{ marginBottom: spacing.md }}>
        {copy?.body}
      </AppText>
      {confirmError ? (
        <AppText color={colors.danger} variant="caption" style={{ marginBottom: spacing.md }}>
          {confirmError}
        </AppText>
      ) : null}
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <AppButton title={copy?.dismissLabel ?? 'Close'} variant="secondary" onPress={closeConfirm} />
        </View>
        <View style={{ flex: 1 }}>
          <AppButton
            title={copy?.confirmLabel ?? 'Confirm'}
            variant={confirmKind === 'cancel' ? 'danger' : 'primary'}
            loading={confirming}
            onPress={confirmKind === 'cancel' ? riderActions.confirmCancel : riderActions.confirmDropoff}
          />
        </View>
      </View>
    </AppSheet>
  );
}
