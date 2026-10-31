import { z } from 'zod';

import { CNIC_PATTERN } from '../utils/cnic';

const currentYear = new Date().getFullYear();

// Mirrors backend CreateUserVehicleDto (excluding the three document URL/publicId
// fields, which are set programmatically after each upload completes, not typed).
// cnicNumber is optional in the DTO (older app builds) but required here.
export const userVehicleFormSchema = z.object({
  make: z.string().min(2, 'Make is too short').max(50, 'Make is too long'),
  model: z.string().min(1, 'Model is required').max(50, 'Model is too long'),
  year: z.number().int().min(1990).max(currentYear + 2).optional(),
  color: z.string().max(30, 'Color is too long').optional().or(z.literal('')),
  plateNumber: z.string().min(2, 'Plate number is too short').max(20, 'Plate number is too long'),
  cnicNumber: z
    .string()
    .trim()
    .min(1, 'Enter your CNIC number')
    .regex(CNIC_PATTERN, 'Enter all 13 digits, e.g. 12345-1234567-1'),
});

export type UserVehicleFormValues = z.infer<typeof userVehicleFormSchema>;
