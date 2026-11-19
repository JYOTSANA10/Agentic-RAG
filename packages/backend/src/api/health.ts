import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    version: '2.2.0-session-guard',
    timestamp: new Date().toISOString(),
  });
});

