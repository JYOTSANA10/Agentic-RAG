import { Pinecone } from '@pinecone-database/pinecone';
import { getEmbeddingModel } from './openai';

let pineconeClient: Pinecone | null = null;

export function getPineconeClient(): Pinecone {
  if (!pineconeClient) {
    pineconeClient = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  }
  return pineconeClient;
}

export function getIndex() {
  return getPineconeClient().index(process.env.PINECONE_INDEX_NAME || 'it-copilot');
}

export async function upsertChunks(
  chunks: Array<{ id: string; text: string; metadata: Record<string, string | number> }>
): Promise<void> {
  const embedder = getEmbeddingModel();
  const namespace = process.env.PINECONE_NAMESPACE || 'company-it-kb';
  const ns = getIndex().namespace(namespace);

  const BATCH = 100;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const embeddings = await embedder.embedDocuments(batch.map((c) => c.text));
    await ns.upsert(
      batch.map((chunk, j) => ({
        id: chunk.id,
        values: embeddings[j],
        metadata: { ...chunk.metadata, text: chunk.text },
      }))
    );
  }
}

export async function retrieveChunks(
  query: string,
  topK = 4
): Promise<Array<{ id: string; text: string; source: string; score: number }>> {
  const embedder = getEmbeddingModel();
  const namespace = process.env.PINECONE_NAMESPACE || 'company-it-kb';
  const ns = getIndex().namespace(namespace);

  const [queryEmbedding] = await embedder.embedDocuments([query]);
  const result = await ns.query({ vector: queryEmbedding, topK, includeMetadata: true });

  return (result.matches || []).map((m) => ({
    id: m.id,
    text: (m.metadata?.text as string) || '',
    source: (m.metadata?.source as string) || 'Unknown',
    score: m.score || 0,
  }));
}

export async function deleteChunksBySource(source: string): Promise<void> {
  const namespace = process.env.PINECONE_NAMESPACE || 'company-it-kb';
  const ns = getIndex().namespace(namespace);
  const safeName = source.replace(/[^a-zA-Z0-9._-]/g, '_');
  try {
    const results = await ns.listPaginated({ prefix: `${safeName}_` });
    const ids = (results.vectors || []).map((v) => v.id!).filter(Boolean);
    if (ids.length > 0) await ns.deleteMany(ids);
  } catch {
    // Index may not have matching vectors — that's fine
  }
}

