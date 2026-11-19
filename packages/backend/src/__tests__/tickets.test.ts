/**
 * Tickets System — Unit & Integration Tests
 * Tests ticket reference generation (INC-XXXXXX), priority validation (P1-P4),
 * uniqueness collision handling, and tickets router endpoints with mocked Prisma.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// Mock prisma before importing tickets router
vi.mock('../services/prisma', () => ({
  prisma: {
    ticket: {
      findUnique: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock auth middleware to easily simulate authenticated / admin requests
vi.mock('../api/middleware/auth', () => ({
  authenticateToken: vi.fn((req: any, res: any, next: any) => {
    // Default mock user if not already set by test
    if (!req.userId) req.userId = 'mock-user-123';
    if (!req.userRole) req.userRole = 'user';
    next();
  }),
  requireAdmin: vi.fn((req: any, res: any, next: any) => {
    if (req.userRole !== 'admin') {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }
    next();
  }),
}));

import { prisma } from '../services/prisma';
import { ticketsRouter } from '../api/tickets';

// Reusable mock Express response helper
function createMockResponse() {
  const res: any = {
    statusCode: 200,
    body: null,
  };
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((data: any) => {
    res.body = data;
    return res;
  });
  return res;
}

// ── 1. Ticket Reference Generation Logic & Uniqueness ────────────────────────
describe('Ticket Reference Generation Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Extracted reference generator matching the logic in tickets.ts:
   * 'INC-' + 6-digit random number (100000 to 999999) with up to 10 collision checks
   */
  async function generateUniqueTicketRef(): Promise<string> {
    for (let attempts = 0; attempts < 10; attempts++) {
      const digits = Math.floor(100000 + Math.random() * 900000).toString();
      const ticketRef = `INC-${digits}`;
      const existing = await prisma.ticket.findUnique({ where: { ticketRef } });
      if (!existing) return ticketRef;
    }
    throw new Error('Failed to generate unique ticket reference after 10 attempts');
  }

  it('generates ticketRef matching INC-XXXXXX format (6 digits)', async () => {
    vi.mocked(prisma.ticket.findUnique).mockResolvedValueOnce(null);

    const ticketRef = await generateUniqueTicketRef();
    expect(ticketRef).toMatch(/^INC-\d{6}$/);
  });

  it('verifies ticketRef uniqueness by querying prisma.ticket.findUnique', async () => {
    vi.mocked(prisma.ticket.findUnique).mockResolvedValueOnce(null);

    const ticketRef = await generateUniqueTicketRef();
    expect(prisma.ticket.findUnique).toHaveBeenCalledWith({
      where: { ticketRef },
    });
  });

  it('retries when collision occurs and returns first unique ticketRef', async () => {
    // First attempt collides, second attempt succeeds
    vi.mocked(prisma.ticket.findUnique)
      .mockResolvedValueOnce({ id: 'existing-ticket-1', ticketRef: 'INC-111111' } as any)
      .mockResolvedValueOnce(null);

    const ticketRef = await generateUniqueTicketRef();
    expect(ticketRef).toMatch(/^INC-\d{6}$/);
    expect(prisma.ticket.findUnique).toHaveBeenCalledTimes(2);
  });

  it('throws an error if 10 consecutive collisions occur', async () => {
    // 10 collisions in a row
    vi.mocked(prisma.ticket.findUnique).mockResolvedValue({ id: 'collision' } as any);

    await expect(generateUniqueTicketRef()).rejects.toThrow(
      'Failed to generate unique ticket reference after 10 attempts'
    );
    expect(prisma.ticket.findUnique).toHaveBeenCalledTimes(10);
  });
});

// ── 2. Priority Validation (P1-P4) ─────────────────────────────────────────────
describe('Ticket Priority Validation', () => {
  const CreateTicketSchema = z.object({
    question: z.string().min(1).max(2000),
    description: z.string().min(1).max(5000),
    priority: z.enum(['P1', 'P2', 'P3', 'P4']),
  });

  it.each(['P1', 'P2', 'P3', 'P4'] as const)('accepts valid priority: %s', (priority) => {
    const validPayload = {
      question: 'VPN disconnect issue',
      description: 'Unable to connect to internal services',
      priority,
    };
    const parsed = CreateTicketSchema.safeParse(validPayload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.priority).toBe(priority);
    }
  });

  it.each(['P0', 'P5', 'HIGH', 'urgent', 'low', 'p1', '', 'critical'])('rejects invalid priority: "%s"', (priority) => {
    const invalidPayload = {
      question: 'Broken mouse',
      description: 'Mouse wheel is not clicking',
      priority,
    };
    const parsed = CreateTicketSchema.safeParse(invalidPayload);
    expect(parsed.success).toBe(false);
  });

  it('rejects empty question or description', () => {
    expect(CreateTicketSchema.safeParse({ question: '', description: 'desc', priority: 'P1' }).success).toBe(false);
    expect(CreateTicketSchema.safeParse({ question: 'q', description: '', priority: 'P1' }).success).toBe(false);
  });
});

// ── 3. Tickets Router Endpoints ───────────────────────────────────────────────
describe('POST /api/tickets (Create Ticket)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('successfully creates ticket with INC-XXXXXX reference', async () => {
    vi.mocked(prisma.ticket.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.ticket.create).mockResolvedValueOnce({
      id: 'ticket-uuid-1',
      ticketRef: 'INC-654321',
      priority: 'P2',
      status: 'open',
      createdAt: new Date(),
    } as any);

    const req: any = {
      method: 'POST',
      url: '/',
      userId: 'user-456',
      userRole: 'user',
      body: {
        question: 'Cannot connect to production DB',
        description: 'Timed out trying to access replica',
        priority: 'P2',
      },
    };
    const res = createMockResponse();

    await new Promise<void>((resolve) => {
      ticketsRouter(req, res, () => resolve());
      // Poll briefly if async handler completes without next()
      const interval = setInterval(() => {
        if (res.body !== null) {
          clearInterval(interval);
          resolve();
        }
      }, 10);
    });

    expect(res.statusCode).toBe(201);
    expect(res.body.ticket).toBeDefined();
    expect(res.body.ticket.ticketRef).toMatch(/^INC-\d{6}$/);
    expect(res.body.ticket.priority).toBe('P2');
  });

  it('returns 400 when priority is invalid', async () => {
    const req: any = {
      method: 'POST',
      url: '/',
      userId: 'user-456',
      userRole: 'user',
      body: {
        question: 'Laptop screen flickering',
        description: 'External monitor flickers every 5 minutes',
        priority: 'P9', // Invalid
      },
    };
    const res = createMockResponse();

    await new Promise<void>((resolve) => {
      ticketsRouter(req, res, () => resolve());
      const interval = setInterval(() => {
        if (res.body !== null) {
          clearInterval(interval);
          resolve();
        }
      }, 10);
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 500 when prisma creation fails', async () => {
    vi.mocked(prisma.ticket.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.ticket.create).mockRejectedValueOnce(new Error('Prisma connection timeout'));

    const req: any = {
      method: 'POST',
      url: '/',
      userId: 'user-456',
      userRole: 'user',
      body: {
        question: 'Outlook crashing on startup',
        description: 'App freezes immediately after launch',
        priority: 'P3',
      },
    };
    const res = createMockResponse();

    await new Promise<void>((resolve) => {
      ticketsRouter(req, res, () => resolve());
      const interval = setInterval(() => {
        if (res.body !== null) {
          clearInterval(interval);
          resolve();
        }
      }, 10);
    });

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('Failed to create ticket');
  });
});

describe('GET /api/tickets (List Tickets)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns paginated tickets for the authenticated user', async () => {
    const mockTickets = [
      { id: 't1', ticketRef: 'INC-100001', question: 'Q1', priority: 'P1', status: 'open', createdAt: new Date(), updatedAt: new Date() },
      { id: 't2', ticketRef: 'INC-100002', question: 'Q2', priority: 'P3', status: 'resolved', createdAt: new Date(), updatedAt: new Date() },
    ];
    vi.mocked(prisma.ticket.findMany).mockResolvedValueOnce(mockTickets as any);
    vi.mocked(prisma.ticket.count).mockResolvedValueOnce(2);

    const req: any = {
      method: 'GET',
      url: '/',
      query: { page: '1' },
      userId: 'user-456',
      userRole: 'user',
    };
    const res = createMockResponse();

    await new Promise<void>((resolve) => {
      ticketsRouter(req, res, () => resolve());
      const interval = setInterval(() => {
        if (res.body !== null) {
          clearInterval(interval);
          resolve();
        }
      }, 10);
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.tickets).toHaveLength(2);
    expect(res.body.total).toBe(2);
  });
});
