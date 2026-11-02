import { z } from 'zod';

// Mirrors backend UpdateProfileDto. The mobile number is not edited here —
// it changes only through WhatsApp verification (sendPhoneCodeSchema below).
export const updateProfileSchema = z.object({
  name: z.string().max(100, 'Name is too long').optional(),
});

export type UpdateProfileFormValues = z.infer<typeof updateProfileSchema>;

// POST /users/me/phone/send-code. The backend checks and normalises the
// number (400 "Enter a valid mobile number…") — only the basics here.
export const sendPhoneCodeSchema = z.object({
  phone: z.string().trim().min(1, 'Mobile number is required').max(20, 'Mobile number is too long'),
});

export type SendPhoneCodeFormValues = z.infer<typeof sendPhoneCodeSchema>;
