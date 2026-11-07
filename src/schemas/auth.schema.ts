import { z } from 'zod';

// Sign-in and sign-up are phone-first (WhatsApp code), with the emailed code
// as the sign-in backup — no passwords. Mirrors kerayego-backend's
// RequestLoginCodeDto and its phone sign-in DTOs (the 6-digit codes
// themselves are checked by features/auth/signInCode.ts).

const emailField = z.string().trim().min(1, 'Email is required').email('Enter a valid email');

export const signInEmailSchema = z.object({
  email: emailField,
});

export type SignInEmailFormValues = z.infer<typeof signInEmailSchema>;

// POST /auth/phone/request. The backend checks and normalises the number
// (400 "Enter a valid mobile number…") — only the basics are checked here:
// something typed, made of digits (spaces, dashes, brackets and a leading +
// allowed), not absurdly long.
export const phoneSignInSchema = z.object({
  phone: z
    .string()
    .trim()
    .min(1, 'Mobile number is required')
    .max(20, 'Mobile number is too long')
    .regex(/^\+?[\d\s\-()]+$/, 'Enter a valid mobile number'),
});

export type PhoneSignInFormValues = z.infer<typeof phoneSignInSchema>;

// POST /auth/phone/register's profile fields (the signupToken comes from the
// code step; role is always USER in this app). Mirrors the backend's 1–100
// character name and valid email.
export const phoneProfileSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name is too long'),
  email: emailField,
});

export type PhoneProfileFormValues = z.infer<typeof phoneProfileSchema>;
