import { Router, Response } from 'express';
import { authenticateToken, requireAdmin, type AuthenticatedRequest } from './middleware/auth';
import { prisma } from '../services/prisma';
import { deleteChunksBySource } from '../services/pinecone';

export const documentsRouter = Router();
documentsRouter.use(authenticateToken, requireAdmin);

documentsRouter.get('/', async (_req: AuthenticatedRequest, res: Response) => {
  const documents = await prisma.document.findMany({ orderBy: { createdAt: 'desc' } });
  res.json({ documents });
});

documentsRouter.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const docId = req.params.id as string;
  const doc = await prisma.document.findUnique({ where: { id: docId } });
  if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }
  await deleteChunksBySource(doc.originalName);
  await prisma.document.delete({ where: { id: docId } });
  res.json({ message: 'Document and vectors deleted successfully' });
});

