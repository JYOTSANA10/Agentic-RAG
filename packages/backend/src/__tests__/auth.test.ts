/**
 * Auth Security Middleware & Endpoints — Unit Tests
 * Tests token extraction, verification, database user validation,
 * error handling (401 status), and role-based access checks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock jsonwebtoken
vi.mock('jsonwebtoken', () => ({
  default: {
    verify: vi.fn(),
    sign: vi.fn(),
  },
  verify: vi.fn(),
  sign: vi.fn(),
}));

// Mock prisma
vi.mock('../services/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import jwt from 'jsonwebtoken';
import { prisma } from '../services/prisma';
import { authenticateToken, requireAdmin, type AuthenticatedRequest } from '../api/middleware/auth';

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

describe('authenticateToken Middleware Security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = 'test-secret-key-at-least-32-chars-long';
  });

  it('returns 401 when no authorization header is provided', async () => {
    const req: any = { headers: {} };
    const res = createMockResponse();
    const next = vi.fn();

    await authenticateToken(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Access token required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when authorization header is empty or malformed', async () => {
    const req: any = { headers: { authorization: 'Bearer ' } };
    const res = createMockResponse();
    const next = vi.fn();

    await authenticateToken(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Access token required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for invalid or expired JWT (jwt.verify throws)', async () => {
    vi.mocked(jwt.verify).mockImplementationOnce(() => {
      throw new Error('jwt expired');
    });

    const req: any = {
      headers: { authorization: 'Bearer expired.jwt.token' },
    };
    const res = createMockResponse();
    const next = vi.fn();

    await authenticateToken(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid or expired token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when user not found in DB (prisma.user.findUnique returns null)', async () => {
    vi.mocked(jwt.verify).mockReturnValueOnce({ userId: 'deleted-user-uuid', role: 'user' } as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);

    const req: any = {
      headers: { authorization: 'Bearer valid.signature.token' },
    };
    const res = createMockResponse();
    const next = vi.fn();

    await authenticateToken(req, res, next);

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'deleted-user-uuid' },
      select: { id: true, role: true },
    });
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      error: 'Session expired or user not found. Please log in again.',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('attaches userId and userRole to req and calls next() on valid token and existing user', async () => {
    vi.mocked(jwt.verify).mockReturnValueOnce({ userId: 'valid-user-123', role: 'admin' } as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: 'valid-user-123',
      role: 'admin',
    } as any);

    const req: any = {
      headers: { authorization: 'Bearer valid.token.here' },
    };
    const res = createMockResponse();
    const next = vi.fn();

    await authenticateToken(req, res, next);

    expect(req.userId).toBe('valid-user-123');
    expect(req.userRole).toBe('admin');
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('requireAdmin Middleware Security', () => {
  it('returns 403 when userRole is not admin', () => {
    const req: any = { userId: 'user-1', userRole: 'user' };
    const res = createMockResponse();
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Admin access required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when userRole is undefined', () => {
    const req: any = { userId: 'user-1' };
    const res = createMockResponse();
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Admin access required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() when userRole is admin', () => {
    const req: any = { userId: 'admin-1', userRole: 'admin' };
    const res = createMockResponse();
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
