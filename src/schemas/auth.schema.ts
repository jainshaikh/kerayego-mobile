import { z } from 'zod';

// Sign-in and sign-up are by emailed code (no passwords). Mirrors
// kerayego-backend RequestLoginCodeDto / RegisterDto (the 6-digit code itself is
// checked by features/auth/signInCode.ts).

const emailField = z.string().trim().min(1, 'Email is required').email('Enter a valid email');

export const signInEmailSchema = z.object({
  email: emailField,
});

export type SignInEmailFormValues = z.infer<typeof signInEmailSchema>;

// The backend checks and normalises the mobile number (400 "Enter a valid
// mobile number…", 409 PHONE_TAKEN) — only the basics are checked here.
export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name is too long'),
  email: emailField,
  phone: z.string().trim().min(1, 'Mobile number is required').max(20, 'Mobile number is too long'),
});

export type RegisterFormValues = z.infer<typeof registerSchema>;
