import { z } from 'zod';

import { BookingTripType, RentalDurationType } from '../types/enums';
import { countError, isPriceToAgree } from '../utils/rentalDuration';
import { MAX_RENTAL_STOPS } from '../features/booking-requests/rentalRequest';

// The rental request sheet (plan §3c, A74–A85) — mirrors the backend's
// CreateBookingRequestDto (new shape). requestedToDate and the total are
// never sent: the server works them out from the package and the count.

// A pickup or drop-off: found by search or placed on the map, so it has
// coordinates (A75). Typing alone leaves them empty — the error sits under
// the place field.
export const rentalStopSchema = z
  .object({
    label: z.string().trim().min(1, 'Choose a place').max(200, 'This place name is too long'),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
  })
  .refine((stop) => stop.lat !== undefined && stop.lng !== undefined, {
    message: 'Pick this place from the suggestions or on the map',
    path: ['label'],
  });

/** The request sheet's rules for one car — passengers go up to its seats (A83). */
export function rentalRequestSchema(seatingCapacity: number) {
  return z
    .object({
      requestedFromDate: z.date({ message: 'Choose the pickup date & time' }),
      durationType: z.nativeEnum(RentalDurationType, { message: 'Choose a package' }),
      durationQuantity: z.number().int(),
      // Priced packages only (checked below); null until picked.
      tripType: z.nativeEnum(BookingTripType).nullable(),
      pickupStops: z.array(rentalStopSchema).min(1, 'Add a pickup point'),
      dropoffStops: z.array(rentalStopSchema).min(1, 'Add a drop-off point'),
      passengerCount: z
        .number()
        .int()
        .min(1, 'At least 1 passenger')
        .max(seatingCapacity, `This car takes at most ${seatingCapacity} passenger${seatingCapacity === 1 ? '' : 's'}`),
      // Week/month (A85): the driver's hours per day and days per week.
      driverHoursPerDay: z.number().int().min(1, 'At least 1 hour').max(24, 'At most 24 hours'),
      daysPerWeek: z.number().int().min(1, 'At least 1 day').max(7, 'At most 7 days'),
      kmPerMonth: z.number().int().min(1).max(100000, 'At most 100,000 km').nullable(),
      message: z.string().max(1000, 'Message is too long').optional().or(z.literal('')),
    })
    .superRefine((values, ctx) => {
      if (!(values.requestedFromDate.getTime() > Date.now())) {
        ctx.addIssue({ code: 'custom', path: ['requestedFromDate'], message: 'Choose a pickup time in the future.' });
      }
      const countProblem = countError(values.durationType, values.durationQuantity);
      if (countProblem) ctx.addIssue({ code: 'custom', path: ['durationQuantity'], message: countProblem });
      if (!isPriceToAgree(values.durationType) && !values.tripType) {
        ctx.addIssue({ code: 'custom', path: ['tripType'], message: 'Choose One way or Round trip' });
      }
      if (values.pickupStops.length + values.dropoffStops.length > MAX_RENTAL_STOPS) {
        ctx.addIssue({
          code: 'custom',
          path: ['dropoffStops'],
          message: `At most ${MAX_RENTAL_STOPS} pickup and drop-off points in all`,
        });
      }
    });
}

export type RentalRequestFormValues = z.infer<ReturnType<typeof rentalRequestSchema>>;
