import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    version: '2.0.0-agentic-rag-v2',
    timestamp: new Date().toISOString(),
  });
});

