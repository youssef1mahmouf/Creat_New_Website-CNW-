/** CNW shared validation layer (framework-agnostic).
 * Uses `zod` for future forms (login, register, contact, product, settings).
 * Existing pages are NOT rewritten — import these schemas only in new code.
 */
import { z } from 'zod';

export { z };

export const emailSchema = z.string().trim().min(1, 'Email is required').email('Enter a valid email');

export const passwordSchema = z.string().min(8, 'Password must be at least 8 characters');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name is required'),
  email: emailSchema,
  password: passwordSchema,
});

export const contactSchema = z.object({
  name: z.string().trim().min(2, 'Name is required'),
  email: emailSchema,
  message: z.string().trim().min(10, 'Message must be at least 10 characters'),
});

/** Validate unknown data against a schema; returns { ok, data, errors }. */
export function validate(schema, data) {
  const res = schema.safeParse(data);
  if (res.success) return { ok: true, data: res.data, errors: null };
  return { ok: false, data: null, errors: res.error.flatten().fieldErrors };
}
