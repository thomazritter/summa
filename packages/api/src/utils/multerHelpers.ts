import { Request, Response, NextFunction } from 'express';
import multer, { MulterError } from 'multer';

/**
 * Custom error for file type validation failures.
 * Used by multer fileFilter callbacks and the shared error handler.
 */
export class FileTypeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileTypeError';
  }
}

/**
 * Create a multer instance configured for PDF-only uploads with in-memory storage.
 *
 * @param maxSize - Maximum file size in bytes
 * @param errorMessage - Custom error message for non-PDF files (defaults to English)
 */
export function createPdfUpload(maxSize: number, errorMessage?: string): multer.Multer {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxSize },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype === 'application/pdf') {
        cb(null, true);
      } else {
        cb(new FileTypeError(errorMessage ?? 'Only PDF files are allowed'));
      }
    },
  });
}

/**
 * Create an Express error-handling middleware for multer upload errors.
 * Handles both MulterError (e.g. file too large) and FileTypeError (wrong mime type).
 *
 * @param maxSize - Maximum file size in bytes (used in the error message)
 */
export function createMulterErrorHandler(maxSize: number) {
  return (err: Error, _req: Request, res: Response, next: NextFunction): void => {
    if (err instanceof MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ error: `File too large. Maximum size is ${maxSize / 1024 / 1024}MB` });
        return;
      }
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof FileTypeError) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  };
}
