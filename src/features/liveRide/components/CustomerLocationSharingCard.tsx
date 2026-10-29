import { useSyncExternalStore } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AppButton, AppCard, AppText } from '../../../components/ui';
import { useTheme } from '../../../theme';
import { useAuth } from '../../../auth/auth-context';
import { normalizeApiError } from '../../../api/errors';
import type { LocationShareTargetRef } from '../../../api/location-sharing.api';
import { useMyLocationSharing, useSetLocationSharingPaused } from '../queries';
import {
  findShareTarget,
  sameShareTarget,
  shareTargetDisplayLabel,
} from '../backgroundLocation/customerLocationRules';
import {
  getCustomerLocationStatus,
  requestCustomerSharingRetry,
  subscribeCustomerLocationStatus,
} from '../backgroundLocation/customerLocationSharing';
import { describeCustomerSharing } from '../backgroundLocation/customerSharingDisplay';

interface CustomerLocationSharingCardProps {
  target: LocationShareTargetRef;
  // 'card' in a scrolling screen; 'bar' a full-width strip under a fixed
  // header (the rider's live view).
  variant?: 'card' | 'bar';
}

// "Sharing your location with your driver" — shown on the carpool rider's
// screens and the rental booking screen only while the backend says this
// seat's / booking's sharing window is open (GET /users/me/location-sharing,
// polled by useCustomerLocationReconcile). Stop / Resume pause it on the
// server (PATCH …location-sharing); warnings say why sharing isn't running
// here (location off, a failed start, an old build, driving a trip).
export function CustomerLocationSharingCard({ target, variant = 'card' }: CustomerLocationSharingCardProps) {
  const { colors, tones, spacing, radii } = useTheme();
  const { user } = useAuth();
  const { data: sharing } = useMyLocationSharing(!!user);
  const status = useSyncExternalStore(
    subscribeCustomerLocationStatus,
    getCustomerLocationStatus,
    getCustomerLocationStatus,
  );
  const setPaused = useSetLocationSharingPaused();

  const listed = findShareTarget(sharing, target);
  if (!listed) return null;

  // Another window being shared right now (one at a time).
  const sharedElsewhere =
    (status.state === 'running' || status.state === 'starting') && !sameShareTarget(status.target, target)
      ? findShareTarget(sharing, status.target)
      : null;
  const view = describeCustomerSharing({ listed, status, otherLabel: sharedElsewhere ? shareTargetDisplayLabel(sharedElsewhere) : null,
  });
  const errorMessage = setPaused.error ? normalizeApiError(setPaused.error).message : null;

  const primary = listed.paused
    ? { label: 'Resume', onPress: () => setPaused.mutate({ target, paused: false }) }
    : { label: 'Stop', onPress: () => setPaused.mutate({ target, paused: true }) };
  const fix = view.fix ? { label: view.fix, onPress: () => requestCustomerSharingRetry(target) } : null;

  const tone = view.tone === 'warning' ? tones.warning : view.tone === 'active' ? tones.success : tones.neutral;

  if (variant === 'bar') {
    return (
      <View
        accessibilityRole={view.tone === 'warning' ? 'alert' : undefined}
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: spacing.sm,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.sm,
          backgroundColor: tone.bg,
        }}
      >
        <Ionicons name={view.icon} size={18} color={tone.fg} style={{ marginTop: 1 }} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText variant="label" color={tone.fg}>
            {view.title}
          </AppText>
          {view.detail ? (
            <AppText variant="caption" color={tone.fg} style={{ marginTop: 2 }}>
              {view.detail}
            </AppText>
          ) : null}
          {errorMessage ? (
            <AppText variant="caption" color={colors.danger} style={{ marginTop: 2 }}>
              {errorMessage}
            </AppText>
          ) : null}
        </View>
        {[fix, primary].map((action) =>
          action ? (
            <Pressable
              key={action.label}
              onPress={action.onPress}
              disabled={setPaused.isPending}
              hitSlop={8}
              accessibilityRole="button"
              style={{ paddingHorizontal: spacing.xs, paddingVertical: 2, borderRadius: radii.md }}
            >
              <AppText variant="label" color={tone.fg} style={{ textDecorationLine: 'underline' }}>
                {action.label}
              </AppText>
            </Pressable>
          ) : null,
        )}
      </View>
    );
  }

  return (
    <AppCard style={{ marginTop: spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: tone.bg,
          }}
        >
          <Ionicons name={view.icon} size={18} color={tone.fg} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText variant="subtitle">{view.title}</AppText>
          {view.detail ? (
            <AppText muted variant="caption" style={{ marginTop: 2 }}>
              {view.detail}
            </AppText>
          ) : null}
        </View>
      </View>
      {errorMessage ? (
        <AppText variant="caption" color={colors.danger} style={{ marginTop: spacing.sm }}>
          {errorMessage}
        </AppText>
      ) : null}
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
        {fix ? (
          <View style={{ flex: 1 }}>
            <AppButton title={fix.label} onPress={fix.onPress} />
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          <AppButton
            title={primary.label}
            variant={listed.paused ? 'primary' : 'outline'}
            loading={setPaused.isPending}
            onPress={primary.onPress}
          />
        </View>
      </View>
      {!listed.paused ? (
        <AppText muted variant="caption" style={{ marginTop: spacing.sm }}>
          Swiping KerayeGo away from your recent apps stops sharing.
        </AppText>
      ) : null}
    </AppCard>
  );
}
