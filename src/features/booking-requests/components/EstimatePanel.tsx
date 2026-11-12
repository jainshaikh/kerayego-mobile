import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AppButton, AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';
import { isRetryableErrorKind, normalizeApiError } from '../../../api/errors';
import type { BookingEstimate, RentalPackageChoice } from '../../../types/api.types';
import type { BookingTripType } from '../../../types/enums';
import { choosePackageLabel, estimatePanelOf, ROUTE_UNAVAILABLE_MESSAGE } from '../rentalRequest';

interface EstimatePanelProps {
  // False until the pickup time, trip type and every place are set.
  ready: boolean;
  // A change is waiting out the debounce, or the estimate is loading.
  checking: boolean;
  estimate: BookingEstimate | undefined;
  error: unknown;
  tripType: BookingTripType | null;
  onRetry: () => void;
  onChoose: (choice: RentalPackageChoice) => void;
}

// The request sheet's estimate (plan §3c, A77): the route's kilometres and
// driving time, the time it needs with stops and breaks, how the chosen
// package fits — or the smallest package that does, with a button that
// switches to it — when it ends and, for a round trip, the time at the
// destination. The server checks it all again on send.
export function EstimatePanel({ ready, checking, estimate, error, tripType, onRetry, onChoose }: EstimatePanelProps) {
  const { colors, spacing, radii } = useTheme();

  let body: ReactNode;
  if (!ready) {
    body = (
      <AppText muted variant="caption">
        Add the pickup time, One way or Round trip and every place to see the route and how it fits.
      </AppText>
    );
  } else if (checking) {
    body = (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <ActivityIndicator size="small" color={colors.primary} />
        <AppText muted variant="caption">
          Checking the route…
        </AppText>
      </View>
    );
  } else if (error) {
    const normalized = normalizeApiError(error);
    const unavailable = normalized.code === 'ROUTE_UNAVAILABLE';
    body = (
      <View style={{ gap: spacing.sm }}>
        <AppText variant="caption" color={colors.danger}>
          {unavailable ? normalized.message || ROUTE_UNAVAILABLE_MESSAGE : normalized.message}
        </AppText>
        {unavailable || isRetryableErrorKind(normalized.kind) ? (
          <AppButton title="Try again" variant="outline" fullWidth={false} onPress={onRetry} />
        ) : null}
      </View>
    );
  } else if (estimate && tripType) {
    const panel = estimatePanelOf(estimate, tripType);
    body = (
      <View style={{ gap: 2 }}>
        <AppText variant="label">{panel.routeLine}</AppText>
        {panel.neededLine ? (
          <AppText muted variant="caption">
            {panel.neededLine}
          </AppText>
        ) : null}
        {panel.fit?.fits ? (
          <>
            <AppText variant="caption" color={colors.success} style={{ marginTop: spacing.xs }}>
              ✓ {panel.fit.line}
            </AppText>
            {panel.fit.endsLine ? (
              <AppText muted variant="caption">
                {panel.fit.endsLine}
              </AppText>
            ) : null}
          </>
        ) : panel.fit ? (
          <View style={{ marginTop: spacing.xs, gap: spacing.sm }}>
            <AppText variant="caption" color={colors.danger}>
              {panel.fit.message}
            </AppText>
            {panel.fit.suggestion ? (
              <AppButton
                title={choosePackageLabel(panel.fit.suggestion)}
                fullWidth={false}
                onPress={() => panel.fit && !panel.fit.fits && panel.fit.suggestion && onChoose(panel.fit.suggestion)}
              />
            ) : null}
          </View>
        ) : null}
        {panel.destinationLine ? (
          <AppText muted variant="caption">
            {panel.destinationLine}
          </AppText>
        ) : null}
      </View>
    );
  } else {
    body = null;
  }

  if (!body) return null;
  return (
    <View
      style={{
        padding: spacing.md,
        borderRadius: radii.md,
        backgroundColor: colors.surfaceAlt,
        marginBottom: spacing.md,
      }}
      accessibilityLiveRegion="polite"
    >
      <AppText muted variant="caption" style={{ marginBottom: spacing.xs }}>
        Route estimate
      </AppText>
      {body}
    </View>
  );
}
