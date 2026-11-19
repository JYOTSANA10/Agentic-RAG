import { Request, Response, NextFunction } from 'express';

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  const isDev = process.env.NODE_ENV !== 'production';

  // Always log the full error server-side; include stack in dev
  if (isDev) {
    console.error('Unhandled error:', err.stack || err);
  } else {
    console.error('Unhandled error:', err.message || err);
  }

  res.status(500).json({
    error: 'Internal server error',
    // Expose message in dev; never expose stack in production
    message: isDev ? err.message : undefined,
  });
}
