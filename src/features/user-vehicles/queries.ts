import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  userVehiclesApi,
  type CreateUserVehiclePayload,
  type UpdateUserVehiclePayload,
} from '../../api/user-vehicles.api';

export function useMyUserVehicles() {
  return useQuery({
    queryKey: ['userVehicles', 'mine'],
    queryFn: () => userVehiclesApi.getMine(),
  });
}

export function useMyApprovedUserVehicles() {
  return useQuery({
    queryKey: ['userVehicles', 'approved'],
    queryFn: () => userVehiclesApi.getApproved(),
  });
}

export function useUserVehicle(id: string | undefined) {
  return useQuery({
    queryKey: ['userVehicles', id],
    queryFn: () => userVehiclesApi.getOne(id as string),
    enabled: !!id,
  });
}

export function useCreateUserVehicle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateUserVehiclePayload) => userVehiclesApi.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['userVehicles'] }),
  });
}

export function useUpdateUserVehicle(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateUserVehiclePayload) => userVehiclesApi.update(id, data),
    onSuccess: (vehicle) => {
      // The response is GET :id's shape, so the detail screen shows the
      // resubmitted (PENDING_REVIEW) vehicle straight away; the lists refetch
      // in the background (not awaited, so the screen can leave right away).
      queryClient.setQueryData(['userVehicles', id], vehicle);
      void queryClient.invalidateQueries({ queryKey: ['userVehicles'] });
    },
  });
}

export function useDeleteUserVehicle(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => userVehiclesApi.remove(id),
    onSuccess: () => {
      // The list and the trip form's approved-vehicle picker drop it.
      void queryClient.invalidateQueries({ queryKey: ['userVehicles', 'mine'] });
      void queryClient.invalidateQueries({ queryKey: ['userVehicles', 'approved'] });
      // Marked stale but not refetched: the vehicle is gone, so a refetch
      // would only 404 under the detail screen as it closes.
      void queryClient.invalidateQueries({ queryKey: ['userVehicles', id], exact: true, refetchType: 'none' });
    },
  });
}
