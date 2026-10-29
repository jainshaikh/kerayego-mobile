import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  reviewsApi,
  type CreateReviewPayload,
  type ReviewSubjectType,
} from '../../api/reviews.api';
import { normalizeApiError } from '../../api/errors';

export function usePublicReviews(subjectType: ReviewSubjectType, subjectId: string | undefined, page = 1) {
  return useQuery({
    queryKey: ['reviews', subjectType, subjectId, page],
    queryFn: () => reviewsApi.getPublic(subjectType, subjectId as string, page),
    enabled: !!subjectId,
  });
}

export function useRatingSummary(subjectType: ReviewSubjectType, subjectId: string | undefined) {
  return useQuery({
    queryKey: ['reviews', 'summary', subjectType, subjectId],
    queryFn: () => reviewsApi.getSummary(subjectType, subjectId as string),
    enabled: !!subjectId,
    staleTime: 60_000,
  });
}

export function useMyEligibleReviews() {
  return useQuery({
    queryKey: ['reviews', 'my', 'eligible'],
    queryFn: reviewsApi.getMyEligible,
  });
}

export function useCreateReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateReviewPayload) => reviewsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reviews'] });
    },
    // 409 "You have already rated this" (e.g. rated from another device) —
    // refetch so the row leaves the "to rate" list.
    onError: (error) => {
      if (normalizeApiError(error).kind === 'conflict') {
        queryClient.invalidateQueries({ queryKey: ['reviews', 'my', 'eligible'] });
      }
    },
  });
}
