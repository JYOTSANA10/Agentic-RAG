import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    version: '2.3.0-prod-ready',
    timestamp: new Date().toISOString(),
  });
});

