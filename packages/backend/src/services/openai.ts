/**
 * LLM + Embeddings service.
 *
 * LLM: Groq API (super fast, free tier, highly reliable)
 * Embeddings: Xenova/bge-small-en-v1.5 (local 384 dimensions - 100% free, no credit limit, matches Pinecone index)
 */

import Groq from 'groq-sdk';

let groqClient: Groq | null = null;

function getGroq(): Groq {
  if (!groqClient) {
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groqClient;
}

export function getChatModel(temperature = 0.2) {
  const client = getGroq();
  const model = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';

  return {
    invoke: async (prompt: string): Promise<{ content: string }> => {
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: Math.max(0.01, temperature),
        max_tokens: 1024,
      });

      const message = response.choices?.[0]?.message;
      const content = message?.content || (message as any)?.reasoning || '';
      return { content };
    },
  };
}

let pipelinePromise: Promise<any> | null = null;

async function getExtractor() {
  if (!pipelinePromise) {
    const { pipeline } = await import('@xenova/transformers');
    pipelinePromise = pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5');
  }
  return pipelinePromise;
}

export function getEmbeddingModel() {
  return {
    embedDocuments: async (texts: string[]): Promise<number[][]> => {
      const extractor = await getExtractor();
      const results: number[][] = [];
      for (const text of texts) {
        const output = await extractor(text, { pooling: 'mean', normalize: true });
        results.push(Array.from(output.data as Float32Array));
      }
      return results;
    },
    embedQuery: async (text: string): Promise<number[]> => {
      const extractor = await getExtractor();
      const output = await extractor(text, { pooling: 'mean', normalize: true });
      return Array.from(output.data as Float32Array);
    },
  };
}
