import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useQueryClient } from '@tanstack/react-query';
import { tripInquiriesApi } from '../../api/trip-inquiries.api';
import { TripInquiryStatus } from '../../types/enums';
import { useAppInForeground } from '../../hooks/useAppInForeground';

/**
 * Polls for incoming seat requests (for trip posters/drivers) and status updates
 * (for riders) in real time while signed in.
 *
 * This bridges environments where remote APNs push isn't delivered (such as iOS Simulator
 * and local testing), triggering the native notification popup immediately whenever
 * a seat request arrives or changes state.
 */
export function useLiveInquiryNotifications(userId: string | undefined): void {
  const queryClient = useQueryClient();
  const inForeground = useAppInForeground();

  const isDriverInitializedRef = useRef(false);
  const knownDriverInquiryIdsRef = useRef<Set<string>>(new Set());

  const isRiderInitializedRef = useRef(false);
  const knownRiderStatusesRef = useRef<Map<string, TripInquiryStatus>>(new Map());

  const lastUserIdRef = useRef<string | undefined>(userId);

  // When signed out or user changes, reset tracking so future sessions don't suppress alerts
  if (lastUserIdRef.current !== userId) {
    lastUserIdRef.current = userId;
    isDriverInitializedRef.current = false;
    knownDriverInquiryIdsRef.current.clear();
    isRiderInitializedRef.current = false;
    knownRiderStatusesRef.current.clear();
  }

  useEffect(() => {
    if (!userId || Platform.OS === 'web' || !inForeground) return;

    let isCancelled = false;

    const checkInquiries = async () => {
      try {
        // 1. Driver / Trip Poster inbox — check for incoming pending seat requests
        const inboxResponse = await tripInquiriesApi.getInbox({ status: TripInquiryStatus.PENDING, limit: 20 });
        if (isCancelled) return;

        const pendingInquiries = inboxResponse?.data ?? [];

        if (!isDriverInitializedRef.current) {
          // First pass: remember existing inquiries without spamming past requests
          for (const inquiry of pendingInquiries) {
            knownDriverInquiryIdsRef.current.add(inquiry.id);
          }
          isDriverInitializedRef.current = true;
        } else {
          // Subsequent passes: check for any new seat request
          for (const inquiry of pendingInquiries) {
            if (!knownDriverInquiryIdsRef.current.has(inquiry.id)) {
              knownDriverInquiryIdsRef.current.add(inquiry.id);

              const riderName = inquiry.user?.name || 'A rider';
              const seats = inquiry.requestedSeats || 1;
              const seatWord = `${seats} seat${seats !== 1 ? 's' : ''}`;
              const destination = inquiry.trip?.destinationCity ? ` on your trip to ${inquiry.trip.destinationCity}` : ' on your trip';

              await Notifications.scheduleNotificationAsync({
                content: {
                  title: 'New seat request',
                  body: `${riderName} requested ${seatWord}${destination}`,
                  sound: true,
                  badge: 1,
                  data: {
                    type: 'tripInquiry.created',
                    recipientRole: 'DRIVER',
                    recipientUserId: userId,
                    tripId: inquiry.trip?.id,
                    tripInquiryId: inquiry.id,
                    inquiryId: inquiry.id,
                  },
                },
                trigger: null,
              });

              void queryClient.invalidateQueries({ queryKey: ['tripInquiryInbox'] });
              void queryClient.invalidateQueries({ queryKey: ['myTrips'] });
            }
          }
        }

        // 2. Rider inbox — check for status changes (accepted / rejected)
        const myRequestsResponse = await tripInquiriesApi.getMine(1, 10);
        if (isCancelled) return;

        const myRequests = myRequestsResponse?.data ?? [];

        if (!isRiderInitializedRef.current) {
          for (const req of myRequests) {
            knownRiderStatusesRef.current.set(req.id, req.status);
          }
          isRiderInitializedRef.current = true;
        } else {
          for (const req of myRequests) {
            const prevStatus = knownRiderStatusesRef.current.get(req.id);
            knownRiderStatusesRef.current.set(req.id, req.status);

            if (prevStatus && prevStatus !== req.status) {
              const destination = req.trip?.destinationCity ? ` to ${req.trip.destinationCity}` : '';

              if (req.status === TripInquiryStatus.ACCEPTED) {
                await Notifications.scheduleNotificationAsync({
                  content: {
                    title: 'Seat request accepted!',
                    body: `Your seat request for trip${destination} was accepted!`,
                    sound: true,
                    badge: 1,
                    data: {
                      type: 'tripInquiry.accepted',
                      recipientRole: 'RIDER',
                      recipientUserId: userId,
                      tripId: req.trip?.id,
                      tripInquiryId: req.id,
                      inquiryId: req.id,
                    },
                  },
                  trigger: null,
                });
                void queryClient.invalidateQueries({ queryKey: ['tripInquiries'] });
                void queryClient.invalidateQueries({ queryKey: ['myActiveRide'] });
              } else if (req.status === TripInquiryStatus.REJECTED) {
                await Notifications.scheduleNotificationAsync({
                  content: {
                    title: 'Seat request declined',
                    body: `Your seat request for trip${destination} was declined.`,
                    sound: true,
                    data: {
                      type: 'tripInquiry.rejected',
                      recipientRole: 'RIDER',
                      recipientUserId: userId,
                      tripId: req.trip?.id,
                      tripInquiryId: req.id,
                      inquiryId: req.id,
                    },
                  },
                  trigger: null,
                });
                void queryClient.invalidateQueries({ queryKey: ['tripInquiries'] });
              }
            }
          }
        }
      } catch (err) {
        // Silently catch background poll issues to keep experience smooth
      }
    };

    // Run initial scan
    void checkInquiries();

    // Poll every 3.5 seconds
    const interval = setInterval(() => {
      void checkInquiries();
    }, 3500);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [userId, inForeground, queryClient]);
}
