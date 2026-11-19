import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    version: '2.1.0-crash-guard',
    timestamp: new Date().toISOString(),
  });
});

