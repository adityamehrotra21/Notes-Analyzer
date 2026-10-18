import { z } from 'zod';

/** Strength rules shared by register and change-password: 8+ chars with a letter and a number. */
export const strongPassword = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password must contain at least one letter and one number');

export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  email: z.email('Enter a valid email').trim().toLowerCase(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

export const loginSchema = z.object({
  email: z.email('Enter a valid email').trim().toLowerCase(),
  password: z.string().min(1, 'Password is required'),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: strongPassword,
  })
  .refine((b) => b.currentPassword !== b.newPassword, { message: 'The new password must be different from the current one', path: ['newPassword'] });

export const forgotPasswordSchema = z.object({
  email: z.email('Enter a valid email').trim().toLowerCase(),
});

export const resetPasswordSchema = z.object({
  email: z.email('Enter a valid email').trim().toLowerCase(),
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from the email'),
  newPassword: strongPassword,
});

export const sessionIdParams = z.object({ id: z.uuid('Invalid session id') });
