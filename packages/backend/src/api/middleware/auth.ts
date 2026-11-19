import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../../services/prisma';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userRole?: string;
}

export async function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) { res.status(401).json({ error: 'Access token required' }); return; }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string; role: string };

    // Verify the user still exists in the database (handles DB resets after deploys)
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, role: true },
    });

    if (!user) {
      res.status(401).json({ error: 'Session expired or user not found. Please log in again.' });
      return;
    }

    req.userId = user.id;
    req.userRole = user.role;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (req.userRole !== 'admin') { res.status(403).json({ error: 'Admin access required' }); return; }
  next();
}

