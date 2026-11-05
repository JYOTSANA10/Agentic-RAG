import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { upsertChunks } from './pinecone';

export async function extractText(filePath: string, originalName: string): Promise<string> {
  const ext = path.extname(originalName).toLowerCase();

  if (ext === '.txt' || ext === '.md') {
    return fs.readFileSync(filePath, 'utf-8');
  }
  if (ext === '.pdf') {
    const pdfParse = (await import('pdf-parse')).default;
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    return data.text;
  }
  if (ext === '.docx') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }
  throw new Error(`Unsupported file type: ${ext}`);
}

export function chunkText(text: string, chunkSize = 900, overlap = 120): string[] {
  const chunks: string[] = [];
  const clean = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  let start = 0;
  while (start < clean.length) {
    const end = Math.min(start + chunkSize, clean.length);
    const chunk = clean.slice(start, end).trim();
    if (chunk.length > 50) chunks.push(chunk);
    if (end >= clean.length) break;
    start = end - overlap;
  }
  return chunks;
}

export function hashContent(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export async function ingestDocument(
  filePath: string,
  originalName: string,
  uploadedBy: string
): Promise<{ chunkCount: number; contentHash: string }> {
  const text = await extractText(filePath, originalName);
  const contentHash = hashContent(text);
  const chunks = chunkText(text);
  const source = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');

  await upsertChunks(
    chunks.map((chunk, i) => ({
      id: `${source}_${i}_${uuidv4().slice(0, 8)}`,
      text: chunk,
      metadata: {
        source: originalName,
        chunkIndex: i,
        uploadedBy,
        namespace: process.env.PINECONE_NAMESPACE || 'company-it-kb',
      },
    }))
  );

  return { chunkCount: chunks.length, contentHash };
}

