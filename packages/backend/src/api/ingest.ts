import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticateToken, requireAdmin, type AuthenticatedRequest } from './middleware/auth';
import { extractText, hashContent, ingestDocument } from '../services/ingestion';
import { prisma } from '../services/prisma';

export const ingestRouter = Router();

const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

/** Allowed file extensions and their expected MIME types */
const ALLOWED_EXTENSIONS: Record<string, string[]> = {
  '.pdf':  ['application/pdf'],
  '.txt':  ['text/plain'],
  '.md':   ['text/plain', 'text/markdown', 'text/x-markdown'],
  '.docx': [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/octet-stream', // some clients send this for docx
  ],
};

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = Object.keys(ALLOWED_EXTENSIONS);

    if (!allowedExts.includes(ext)) {
      cb(new Error('Unsupported file type. Allowed: PDF, TXT, MD, DOCX'));
      return;
    }

    // MIME type validation — in addition to extension check
    const allowedMimes = ALLOWED_EXTENSIONS[ext];
    if (!allowedMimes.includes(file.mimetype)) {
      cb(new Error(`Invalid MIME type "${file.mimetype}" for extension "${ext}"`));
      return;
    }

    cb(null, true);
  },
});

ingestRouter.post('/', authenticateToken, requireAdmin, upload.single('file'), async (req: AuthenticatedRequest, res: Response) => {
  if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }

  try {
    // TASK 3 FIX: Check for duplicate BEFORE ingesting vectors.
    // Extract text and compute hash without calling ingestDocument (which writes to Pinecone).
    const text = await extractText(req.file.path, req.file.originalname);
    const contentHash = hashContent(text);

    const existing = await prisma.document.findUnique({ where: { contentHash } });
    if (existing) {
      fs.unlinkSync(req.file.path);
      res.status(409).json({ error: 'Document already ingested', document: existing });
      return;
    }

    // No duplicate — proceed with full ingestion (vectors + DB record)
    const { chunkCount } = await ingestDocument(req.file.path, req.file.originalname, req.userId!);

    const doc = await prisma.document.create({
      data: {
        filename: req.file.filename,
        originalName: req.file.originalname,
        contentHash,
        chunkCount,
        namespace: process.env.PINECONE_NAMESPACE || 'company-it-kb',
        uploadedBy: req.userId!,
        sizeBytes: req.file.size,
      },
    });

    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(201).json({ message: 'Document ingested successfully', document: doc, chunkCount });
  } catch (err: any) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error('Ingest error:', err?.message || err);
    res.status(500).json({ error: 'Failed to ingest document', message: process.env.NODE_ENV !== 'production' ? err?.message : undefined });
  }
});
