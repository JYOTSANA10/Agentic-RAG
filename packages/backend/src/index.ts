import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import { authRouter } from './api/auth';
import { chatRouter } from './api/chat';
import { ingestRouter } from './api/ingest';
import { documentsRouter } from './api/documents';
import { auditRouter } from './api/audit';
import { healthRouter } from './api/health';
import { errorHandler } from './api/middleware/errorHandler';
import { prisma } from './services/prisma';

const app = express();
const PORT = process.env.PORT || 3001;

// Security headers - disable strict CSP so SPA assets load cleanly
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// API Routes
app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/chat', chatRouter);
app.use('/api/ingest', ingestRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/audit', auditRouter);

// Serve Frontend SPA in Production / Single-Container mode
const possibleDistPaths = [
  path.resolve(__dirname, '../../frontend/dist'),
  path.resolve(__dirname, '../frontend/dist'),
  path.resolve(process.cwd(), 'packages/frontend/dist'),
  path.resolve(process.cwd(), 'dist/frontend'),
];

const frontendDist = possibleDistPaths.find((p) => fs.existsSync(p));

if (frontendDist) {
  console.log(`📦 Serving static frontend from: ${frontendDist}`);
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

app.use(errorHandler);

async function start() {
  try {
    await prisma.$connect();
    console.log('✅ Database connected');
    app.listen(PORT, () => {
      console.log(`🚀 IT Copilot running on http://localhost:${PORT}`);
      console.log(`📚 Health check available at http://localhost:${PORT}/api/health`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

start();
