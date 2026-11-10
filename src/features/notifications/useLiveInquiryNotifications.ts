import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useQueryClient } from '@tanstack/react-query';
import { tripInquiriesApi } from '../../api/trip-inquiries.api';
import type { ChatMessage } from '../../api/trip-inquiries.api';
import { TripInquiryStatus } from '../../types/enums';
import type { TripStatus } from '../../types/enums';
import { LOCAL_PUSH_BRIDGE_ENABLED } from '../../constants/config';
import { connectRideSocket, onChatMessage, subscribeInquiryNotifications } from '../liveRide/socket';

/**
 * Local notification bridge — a developer aid for a simulator or device that
 * gets no real pushes (an iOS simulator, a build without FCM). OFF unless
 * EXPO_PUBLIC_LOCAL_PUSH_BRIDGE=true (constants/config.ts): the backend sends
 * a real push for every event below, so with this on where pushes do arrive,
 * each one shows twice. When on, for the signed-in user:
 * - listens for chat messages on the ride socket (joining every accepted
 *   inquiry's room) and shows "New message";
 * - every 10 s polls the driver's inbox (new seat requests) and the rider's
 *   requests (accepted / declined, trip started / completed), and the first
 *   page of each accepted inquiry's chat.
 * It only runs while the app is open (a plain interval — nothing here runs in
 * the background). The notifications carry push-shaped data, so tapping one
 * routes like a real push.
 */
export function useLiveInquiryNotifications(signedInUserId: string | undefined): void {
  const queryClient = useQueryClient();
  // Hooks run unconditionally; with the bridge off every effect below sees
  // no user and does nothing.
  const userId = LOCAL_PUSH_BRIDGE_ENABLED ? signedInUserId : undefined;

  const isDriverInitializedRef = useRef(false);
  const knownDriverInquiryIdsRef = useRef<Set<string>>(new Set());

  const isRiderInitializedRef = useRef(false);
  const knownRiderStatusesRef = useRef<Map<string, TripInquiryStatus>>(new Map());
  const knownTripStatusesRef = useRef<Map<string, TripStatus>>(new Map());

  const isChatInitializedRef = useRef<Map<string, boolean>>(new Map());
  const knownChatMessageIdsRef = useRef<Set<string>>(new Set());

  const lastUserIdRef = useRef<string | undefined>(userId);

  // Reset tracking when user switches or logs out. An effect (refs can't be
  // touched during render), declared before the others: React runs a commit's
  // effects in order, so the reset lands before they restart for the new user.
  useEffect(() => {
    if (lastUserIdRef.current === userId) return;
    lastUserIdRef.current = userId;
    isDriverInitializedRef.current = false;
    knownDriverInquiryIdsRef.current.clear();
    isRiderInitializedRef.current = false;
    knownRiderStatusesRef.current.clear();
    knownTripStatusesRef.current.clear();
    isChatInitializedRef.current.clear();
    knownChatMessageIdsRef.current.clear();
  }, [userId]);

  // -------------------------------------------------------------
  // 1. REAL-TIME CHAT: WebSocket listener (instant, zero rate limits)
  // -------------------------------------------------------------
  useEffect(() => {
    if (!userId || Platform.OS === 'web') return;

    connectRideSocket();

    const unsubscribe = onChatMessage(async (msg: ChatMessage) => {
      // Record message as known so polling doesn't duplicate it
      knownChatMessageIdsRef.current.add(msg.id);

      // Only pop notification if message came from the other person
      if (msg.senderId !== userId) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: 'New message',
            body: msg.body,
            sound: true,
            badge: 1,
            data: {
              type: 'chat_message',
              tripInquiryId: msg.tripInquiryId,
              messageId: msg.id,
              recipientUserId: userId,
            },
          },
          trigger: null,
        });
      }
    });

    return () => {
      unsubscribe();
    };
  }, [userId, queryClient]);

  // -------------------------------------------------------------
  // 2. INQUIRIES, RIDES & CHAT FALLBACK: Polled on a calm 10s interval
  // -------------------------------------------------------------
  useEffect(() => {
    if (!userId || Platform.OS === 'web') return;

    let isCancelled = false;

    const checkLiveUpdates = async () => {
      try {
        // DRIVER: Query inbox (limit 10) to cover both PENDING seat requests and ACCEPTED inquiries
        const inboxResponse = await tripInquiriesApi.getInbox({ limit: 10 });
        if (isCancelled) return;

        const allInboxInquiries = inboxResponse?.data ?? [];
        const pendingInquiries = allInboxInquiries.filter((i) => i.status === TripInquiryStatus.PENDING);
        const acceptedDriverInquiries = allInboxInquiries.filter((i) => i.status === TripInquiryStatus.ACCEPTED);

        if (!isDriverInitializedRef.current) {
          for (const inquiry of pendingInquiries) {
            knownDriverInquiryIdsRef.current.add(inquiry.id);
          }
          isDriverInitializedRef.current = true;
        } else {
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

        // RIDER: Inquiry status changes & Trip status changes
        const myRequestsResponse = await tripInquiriesApi.getMine(1, 10);
        if (isCancelled) return;

        const myRequests = myRequestsResponse?.data ?? [];
        const acceptedRiderInquiries = myRequests.filter((r) => r.status === TripInquiryStatus.ACCEPTED);

        if (!isRiderInitializedRef.current) {
          for (const req of myRequests) {
            knownRiderStatusesRef.current.set(req.id, req.status);
            if (req.trip?.id && req.trip?.status) {
              knownTripStatusesRef.current.set(req.trip.id, req.trip.status);
            }
          }
          isRiderInitializedRef.current = true;
        } else {
          for (const req of myRequests) {
            const prevStatus = knownRiderStatusesRef.current.get(req.id);
            knownRiderStatusesRef.current.set(req.id, req.status);

            const destination = req.trip?.destinationCity ? ` to ${req.trip.destinationCity}` : '';

            // Status: PENDING -> ACCEPTED
            if (prevStatus && prevStatus !== req.status) {
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
                void queryClient.invalidateQueries({ queryKey: ['myTripInquiries'] });
                void queryClient.invalidateQueries({ queryKey: ['tripInquiry', req.id] });
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
                void queryClient.invalidateQueries({ queryKey: ['myTripInquiries'] });
                void queryClient.invalidateQueries({ queryKey: ['tripInquiry', req.id] });
              }
            }

            // Trip status changes: ACTIVE -> IN_PROGRESS / COMPLETED
            if (req.trip?.id && req.trip?.status) {
              const prevTripStatus = knownTripStatusesRef.current.get(req.trip.id);
              knownTripStatusesRef.current.set(req.trip.id, req.trip.status);

              if (prevTripStatus && prevTripStatus !== req.trip.status && req.status === TripInquiryStatus.ACCEPTED) {
                if (req.trip.status === 'IN_PROGRESS') {
                  await Notifications.scheduleNotificationAsync({
                    content: {
                      title: 'Trip started!',
                      body: `Your driver has started the trip${destination}.`,
                      sound: true,
                      badge: 1,
                      data: {
                        type: 'trip.started',
                        recipientRole: 'RIDER',
                        recipientUserId: userId,
                        tripId: req.trip.id,
                        tripInquiryId: req.id,
                      },
                    },
                    trigger: null,
                  });
                  void queryClient.invalidateQueries({ queryKey: ['myActiveRide'] });
                } else if (req.trip.status === 'COMPLETED') {
                  await Notifications.scheduleNotificationAsync({
                    content: {
                      title: 'Trip completed',
                      body: `Your trip${destination} has been completed!`,
                      sound: true,
                      data: {
                        type: 'trip.completed',
                        recipientRole: 'RIDER',
                        recipientUserId: userId,
                        tripId: req.trip.id,
                        tripInquiryId: req.id,
                      },
                    },
                    trigger: null,
                  });
                  void queryClient.invalidateQueries({ queryKey: ['myActiveRide'] });
                }
              }
            }
          }
        }

        // 3. REAL-TIME CHAT SYNC:
        // Automatically subscribe to WebSocket chat rooms for all accepted inquiries
        // so the backend knows this device is listening and broadcasts messages directly!
        const acceptedInquiryIds = new Set<string>();
        for (const inq of acceptedDriverInquiries) acceptedInquiryIds.add(inq.id);
        for (const inq of acceptedRiderInquiries) acceptedInquiryIds.add(inq.id);

        for (const inqId of acceptedInquiryIds) {
          subscribeInquiryNotifications(inqId);

          // Calm HTTP fallback check for this accepted inquiry:
          try {
            const chatRes = await tripInquiriesApi.getMessages(inqId);
            if (isCancelled) return;
            const messages = chatRes?.data ?? [];

            if (!isChatInitializedRef.current.get(inqId)) {
              for (const m of messages) {
                knownChatMessageIdsRef.current.add(m.id);
              }
              isChatInitializedRef.current.set(inqId, true);
            } else {
              for (const m of messages) {
                if (!knownChatMessageIdsRef.current.has(m.id)) {
                  knownChatMessageIdsRef.current.add(m.id);
                  if (m.senderId !== userId) {
                    await Notifications.scheduleNotificationAsync({
                      content: {
                        title: 'New message',
                        body: m.body,
                        sound: true,
                        badge: 1,
                        data: {
                          type: 'chat_message',
                          tripInquiryId: inqId,
                          messageId: m.id,
                          recipientUserId: userId,
                        },
                      },
                      trigger: null,
                    });
                  }
                }
              }
            }
          } catch {
            // Ignore chat catchup errors to avoid interrupting the main poll
          }
        }
      } catch {
        // Silently catch background poll issues to keep experience smooth
      }
    };

    // Run initial scan
    void checkLiveUpdates();

    // Poll every 10 seconds to stay safely within backend rate limits
    const interval = setInterval(() => {
      void checkLiveUpdates();
    }, 10_000);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [userId, queryClient]);
}
