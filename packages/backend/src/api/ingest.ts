import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticateToken, requireAdmin, type AuthenticatedRequest } from './middleware/auth';
import { ingestDocument } from '../services/ingestion';
import { prisma } from '../services/prisma';

export const ingestRouter = Router();

const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    ['.pdf', '.txt', '.md', '.docx'].includes(ext)
      ? cb(null, true)
      : cb(new Error('Unsupported file type. Allowed: PDF, TXT, MD, DOCX'));
  },
});

ingestRouter.post('/', authenticateToken, requireAdmin, upload.single('file'), async (req: AuthenticatedRequest, res: Response) => {
  if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }
  try {
    const { chunkCount, contentHash } = await ingestDocument(req.file.path, req.file.originalname, req.userId!);
    const existing = await prisma.document.findUnique({ where: { contentHash } });
    if (existing) {
      fs.unlinkSync(req.file.path);
      res.status(409).json({ error: 'Document already ingested', document: existing }); return;
    }
    const doc = await prisma.document.create({
      data: {
        filename: req.file.filename,
        originalName: req.file.originalname,
        contentHash, chunkCount,
        namespace: process.env.PINECONE_NAMESPACE || 'company-it-kb',
        uploadedBy: req.userId!,
        sizeBytes: req.file.size,
      },
    });
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(201).json({ message: 'Document ingested successfully', document: doc, chunkCount });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    throw err;
  }
});

