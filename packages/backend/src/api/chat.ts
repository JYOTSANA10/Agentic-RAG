import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticateToken, type AuthenticatedRequest } from './middleware/auth';
import { runWorkflow } from '../rag/workflow';
import { prisma } from '../services/prisma';

export const chatRouter = Router();
chatRouter.use(authenticateToken);

const ChatSchema = z.object({
  question: z.string().min(1).max(2000),
  conversationId: z.string().uuid().optional(),
  allowWebFallback: z.boolean().default(true),
});

chatRouter.post('/', async (req: AuthenticatedRequest, res: Response) => {
  const startTime = Date.now();
  try {
    const { question, conversationId, allowWebFallback } = ChatSchema.parse(req.body);
    const userId = req.userId!;

    let convId = conversationId;
    if (!convId) {
      const conv = await prisma.conversation.create({
        data: { userId, title: question.slice(0, 60) },
      });
      convId = conv.id;
    }

    await prisma.message.create({ data: { conversationId: convId, role: 'user', content: question } });

    const result = await runWorkflow(question, allowWebFallback);
    const latencyMs = Date.now() - startTime;
    const citations = result.sourceType === 'web' ? result.webResults : result.documents;

    const assistantMsg = await prisma.message.create({
      data: {
        conversationId: convId,
        role: 'assistant',
        content: result.answer,
        sourceType: result.sourceType,
        citations: JSON.stringify(citations),
        traceSteps: JSON.stringify(result.trace),
      },
    });

    await prisma.auditLog.create({
      data: { userId, question, sourceType: result.sourceType, latencyMs, retriesUsed: 1 - result.retriesLeft },
    });

    res.json({
      conversationId: convId,
      messageId: assistantMsg.id,
      answer: result.answer,
      sourceType: result.sourceType,
      citations,
      trace: result.trace,
      latencyMs,
    });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: 'Validation failed', details: err.errors }); return; }
    throw err;
  }
});

chatRouter.get('/conversations', async (req: AuthenticatedRequest, res: Response) => {
  const conversations = await prisma.conversation.findMany({
    where: { userId: req.userId! },
    orderBy: { updatedAt: 'desc' },
    take: 50,
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });
  res.json({ conversations });
});

chatRouter.get('/conversations/:id', async (req: AuthenticatedRequest, res: Response) => {
  const convId = req.params.id as string;
  const conv = await prisma.conversation.findFirst({
    where: { id: convId, userId: req.userId! },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });
  if (!conv) { res.status(404).json({ error: 'Conversation not found' }); return; }
  const messages = (conv as any).messages.map((m: any) => ({
    ...m,
    citations: m.citations ? JSON.parse(m.citations) : [],
    traceSteps: m.traceSteps ? JSON.parse(m.traceSteps) : [],
  }));
  res.json({ conversation: { ...conv, messages } });
});

