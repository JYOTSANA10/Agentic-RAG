import { Router, Response } from 'express';
import { authenticateToken, requireAdmin, type AuthenticatedRequest } from './middleware/auth';
import { prisma } from '../services/prisma';
import { deleteChunksBySource } from '../services/pinecone';

export const documentsRouter = Router();
documentsRouter.use(authenticateToken, requireAdmin);

documentsRouter.get('/', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const documents = await prisma.document.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ documents });
  } catch (err: any) {
    console.error('List documents error:', err?.message || err);
    res.status(500).json({ error: 'Failed to list documents' });
  }
});

documentsRouter.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const docId = req.params.id as string;
    const doc = await prisma.document.findUnique({ where: { id: docId } });
    if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }
    await deleteChunksBySource(doc.originalName);
    await prisma.document.delete({ where: { id: docId } });
    res.json({ message: 'Document and vectors deleted successfully' });
  } catch (err: any) {
    console.error('Delete document error:', err?.message || err);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});
