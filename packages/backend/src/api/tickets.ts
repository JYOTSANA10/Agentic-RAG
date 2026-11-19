import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticateToken, requireAdmin, type AuthenticatedRequest } from './middleware/auth';
import { prisma } from '../services/prisma';

export const ticketsRouter = Router();
ticketsRouter.use(authenticateToken);

const CreateTicketSchema = z.object({
  question: z.string().min(1).max(2000),
  description: z.string().min(1).max(5000),
  priority: z.enum(['P1', 'P2', 'P3', 'P4']),
});

const UpdateStatusSchema = z.object({
  status: z.enum(['open', 'in_progress', 'resolved']),
});

/** Generate a unique INC-XXXXXX ticket reference, checking DB for collisions */
async function generateUniqueTicketRef(): Promise<string> {
  for (let attempts = 0; attempts < 10; attempts++) {
    const digits = Math.floor(100000 + Math.random() * 900000).toString();
    const ticketRef = `INC-${digits}`;
    const existing = await prisma.ticket.findUnique({ where: { ticketRef } });
    if (!existing) return ticketRef;
  }
  throw new Error('Failed to generate unique ticket reference after 10 attempts');
}

// POST /api/tickets — create a ticket (any authenticated user)
ticketsRouter.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { question, description, priority } = CreateTicketSchema.parse(req.body);
    const userId = req.userId!;

    const ticketRef = await generateUniqueTicketRef();
    const ticket = await prisma.ticket.create({
      data: { ticketRef, userId, question, description, priority },
      select: { id: true, ticketRef: true, priority: true, status: true, createdAt: true },
    });

    res.status(201).json({ ticket });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    console.error('Create ticket error:', err?.message || err);
    res.status(500).json({ error: 'Failed to create ticket' });
  }
});

// GET /api/tickets — list user's own tickets (paginated)
ticketsRouter.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = 20;
    const skip = (page - 1) * limit;

    const [tickets, total] = await Promise.all([
      prisma.ticket.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: { id: true, ticketRef: true, question: true, priority: true, status: true, createdAt: true, updatedAt: true },
      }),
      prisma.ticket.count({ where: { userId } }),
    ]);

    res.json({ tickets, total, page, pages: Math.ceil(total / limit) });
  } catch (err: any) {
    console.error('List tickets error:', err?.message || err);
    res.status(500).json({ error: 'Failed to list tickets' });
  }
});

// GET /api/tickets/:id — get single ticket (only owner or admin)
ticketsRouter.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ticketId = req.params.id as string;
    const userId = req.userId!;
    const userRole = req.userRole!;

    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }
    if (ticket.userId !== userId && userRole !== 'admin') {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    res.json({ ticket });
  } catch (err: any) {
    console.error('Get ticket error:', err?.message || err);
    res.status(500).json({ error: 'Failed to retrieve ticket' });
  }
});

// PATCH /api/tickets/:id/status — update status (admin only)
ticketsRouter.patch('/:id/status', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ticketId = req.params.id as string;
    const { status } = UpdateStatusSchema.parse(req.body);

    const existing = await prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!existing) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }

    const ticket = await prisma.ticket.update({
      where: { id: ticketId },
      data: { status },
      select: { id: true, ticketRef: true, priority: true, status: true, updatedAt: true },
    });

    res.json({ ticket });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    console.error('Update ticket status error:', err?.message || err);
    res.status(500).json({ error: 'Failed to update ticket status' });
  }
});
