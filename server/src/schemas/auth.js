import { z } from 'zod';
import { isValidEmailFormat } from '../utils/email.js';

/** Trimmed + lower-cased first, so a stray space from autofill isn't an error. */
const emailField = z.string('Enter your email').trim().toLowerCase().refine(isValidEmailFormat, 'Enter a valid email address');

/** Strength rules shared by register and change-password: 8+ chars with a letter and a number. */
export const strongPassword = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password must contain at least one letter and one number');

export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  email: emailField,
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, 'Password is required'),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: strongPassword,
  })
  .refine((b) => b.currentPassword !== b.newPassword, { message: 'The new password must be different from the current one', path: ['newPassword'] });

export const forgotPasswordSchema = z.object({
  email: emailField,
});

export const resetPasswordSchema = z.object({
  email: emailField,
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from the email'),
  newPassword: strongPassword,
});

export const sessionIdParams = z.object({ id: z.uuid('Invalid session id') });
