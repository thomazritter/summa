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
