/**
 * Parse and validate an ID string to a positive integer.
 * Returns null if invalid.
 */
export const parseId = (id: string): number | null => {
  const parsed = parseInt(id, 10);
  if (isNaN(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
};

/**
 * Safely parse JSON, returning undefined on failure.
 */
export const safeJsonParse = <T>(json: string | null | undefined): T | undefined => {
  if (!json) {
    return undefined;
  }
  try {
    return JSON.parse(json) as T;
  } catch {
    return undefined;
  }
};

/**
 * Maximum PDF file size in bytes (10MB)
 */
export const MAX_PDF_SIZE = 10 * 1024 * 1024;

/**
 * Format a ZodError into a flat semicolon-separated string suitable for the
 * `error` field of a 400 JSON response. Same shape as the inlined version
 * that was duplicated across ~10 route handlers.
 */
import type { ZodError } from 'zod';
export const zodErrorMessage = (err: ZodError, includePath = false): string =>
  err.errors
    .map((e) => (includePath && e.path.length > 0 ? `${e.path.join('.')}: ${e.message}` : e.message))
    .join('; ');
