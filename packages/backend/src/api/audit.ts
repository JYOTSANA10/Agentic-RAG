import { Router, Response } from 'express';
import { authenticateToken, requireAdmin, type AuthenticatedRequest } from './middleware/auth';
import { prisma } from '../services/prisma';

export const auditRouter = Router();
auditRouter.use(authenticateToken, requireAdmin);

auditRouter.get('/', async (req: AuthenticatedRequest, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = 20;
  const skip = (page - 1) * limit;
  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' }, skip, take: limit,
      include: { user: { select: { email: true, name: true } } },
    }),
    prisma.auditLog.count(),
  ]);
  res.json({ logs, total, page, pages: Math.ceil(total / limit) });
});

