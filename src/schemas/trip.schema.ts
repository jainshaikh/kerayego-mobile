import { z } from 'zod';

// One stop in a trip's ordered pickup or drop-off sequence (A → B → C → D → E) —
// alternate meeting points at each end.
export const tripStopFormSchema = z.object({
  label: z
    .string()
    .min(1, 'Location is required')
    .min(3, 'Location must be at least 3 characters')
    .max(300, 'Location is too long'),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

export type TripStopFormValue = z.infer<typeof tripStopFormSchema>;

// Mirrors backend CreateTripDto / UpdateTripDto.
export const tripFormSchema = z.object({
  userVehicleId: z.string().min(1, 'Select a vehicle'),
  originCity: z
    .string()
    .min(2, 'Origin city is too short')
    .max(100, 'Origin city is too long'),
  destinationCity: z
    .string()
    .min(2, 'Destination city is too short')
    .max(100, 'Destination city is too long'),
  pickupStops: z
    .array(tripStopFormSchema)
    .min(1, 'At least one pickup point is required')
    .max(10, 'Maximum 10 pickup points'),
  dropoffStops: z
    .array(tripStopFormSchema)
    .min(1, 'At least one drop-off point is required')
    .max(10, 'Maximum 10 drop-off points'),
  // Legacy single-point fields kept for backward compatibility:
  pickupPoint: z.string().optional(),
  pickupLat: z.number().optional(),
  pickupLng: z.number().optional(),
  dropoffPoint: z.string().optional(),
  dropoffLat: z.number().optional(),
  dropoffLng: z.number().optional(),
  departureAt: z
    .date({ message: 'Pick a departure date and time' })
    .refine((d) => d > new Date(), {
      message: 'Departure must be in the future',
    }),
  // An emptied field holds null (see utils/numberInput.ts), hence the
  // invalid-type message. Limits mirror CreateTripDto.
  availableSeats: z
    .number({ message: 'Enter how many seats you can offer' })
    .int()
    .min(1, 'Offer at least 1 seat')
    .max(20, 'You can offer at most 20 seats'),
  pricePerSeat: z.number({ message: 'Enter a price per seat' }).min(1, 'Price per seat must be at least 1'),
  contactNumber: z
    .string()
    .min(1, 'Contact number is required')
    .max(20, 'Contact number is too long'),
  notes: z.string().max(500, 'Notes are too long').optional().or(z.literal('')),
});

export type TripFormValues = z.infer<typeof tripFormSchema>;

