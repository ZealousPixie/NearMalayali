// Client-side validation. These mirror the server rules so people get instant
// feedback; the database enforces the same rules regardless.
import { z } from 'zod';

import { MIN_AGE } from './env';

export const USERNAME_RE = /^[a-z0-9_]{3,24}$/;

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address.');

export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters.')
  .max(72, 'Use at most 72 characters.')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Use both letters and numbers.');

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => v.replace(/^@/, ''))
  .refine((v) => USERNAME_RE.test(v), '3–24 characters: letters, numbers and underscores only.');

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter the name people will see.')
  .max(50, 'Keep it under 50 characters.');

export const otpSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code from the email.');

/** Whole years between dateOfBirth and today (local dates). */
export function ageOn(dateOfBirth: Date, today: Date = new Date()): number {
  let age = today.getFullYear() - dateOfBirth.getFullYear();
  const beforeBirthday =
    today.getMonth() < dateOfBirth.getMonth() ||
    (today.getMonth() === dateOfBirth.getMonth() && today.getDate() < dateOfBirth.getDate());
  if (beforeBirthday) age -= 1;
  return age;
}

export function isEligibleAge(dateOfBirth: Date, today: Date = new Date()): boolean {
  return ageOn(dateOfBirth, today) >= MIN_AGE;
}

/** Date as YYYY-MM-DD using local calendar fields (no UTC shift). */
export function toIsoDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Splits comma-separated free text into a clean, de-duplicated tag list. */
export function parseTags(input: string, maxItems: number, maxLen = 30): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(',')) {
    const tag = raw.trim().slice(0, maxLen);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** First failing message from a zod parse, or null when valid. */
export function firstError<T>(schema: z.ZodType<T>, value: unknown): string | null {
  const r = schema.safeParse(value);
  return r.success ? null : (r.error.issues[0]?.message ?? 'Invalid value.');
}
