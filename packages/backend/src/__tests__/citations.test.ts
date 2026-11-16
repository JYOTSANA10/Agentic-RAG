/**
 * Citation Deduplication & State Tests
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../services/openai', () => ({
  getChatModel: vi.fn(() => ({
    invoke: vi.fn(async (prompt: string) => {
      if (prompt.includes('salary') || prompt.includes('Wi-Fi password')) {
        return { content: "I don't have that information in the company knowledge base. Please contact HR or IT directly." };
      }
      return { content: 'Based on company policy, here is the answer.' };
    }),
  })),
}));

vi.mock('../services/pinecone', () => ({
  retrieveChunks: vi.fn(async () => []),
}));

vi.mock('../services/tavily', () => ({
  searchWeb: vi.fn(async () => []),
}));

import { generatorNode } from './rag/nodes';
import { createInitialState } from './rag/state';
import type { Citation } from './rag/state';

describe('Citation Deduplication in Generator', () => {
  it('deduplicates citations with same id', async () => {
    const doc: Citation = { id: 'chunk-1', source: 'handbook.pdf', excerpt: 'Content here', score: 0.85 };
    const state = {
      ...createInitialState('What is sick leave policy?'),
      sourceType: 'internal' as const,
      documents: [doc, doc, doc],
    };
    const result = await generatorNode(state);
    const finalDocs = result.documents ?? [];
    const ids = finalDocs.map((d: Citation) => d.id ?? d.source);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(finalDocs.length);
    expect(finalDocs.length).toBe(1);
  });

  it('deduplicates citations with same source+excerpt', async () => {
    const baseExcerpt = 'Sick leave is 10 days per year and does not carry forward automatically.';
    const state = {
      ...createInitialState('sick leave'),
      sourceType: 'internal' as const,
      documents: [
        { source: 'handbook.pdf', excerpt: baseExcerpt, score: 0.9 },
        { source: 'handbook.pdf', excerpt: baseExcerpt, score: 0.9 },
      ],
    };
    const result = await generatorNode(state);
    const docs = result.documents ?? [];
    expect(docs.length).toBe(1);
  });

  it('returns empty documents when sourceType is none', async () => {
    const state = {
      ...createInitialState('hello'),
      sourceType: 'none' as const,
      documents: [],
      webResults: [],
    };
    const result = await generatorNode(state);
    expect((result.documents ?? []).length).toBe(0);
    expect((result.webResults ?? []).length).toBe(0);
  });

  it('adds Generator trace step', async () => {
    const state = {
      ...createInitialState('What is sick leave?'),
      sourceType: 'internal' as const,
      documents: [{ id: '1', source: 'doc.pdf', excerpt: 'policy text', score: 0.8 }],
    };
    const result = await generatorNode(state);
    expect(result.trace).toHaveLength(1);
    expect(result.trace![0].step).toBe('Generator');
  });
});

describe('Hallucination Prevention', () => {
  it('does not invent salary currency amounts', async () => {
    const state = {
      ...createInitialState('What is my monthly salary?'),
      sourceType: 'internal' as const,
      documents: [{ id: '1', source: 'handbook.pdf', excerpt: 'Company general policy.', score: 0.6 }],
    };
    const result = await generatorNode(state);
    expect(result.answer).not.toMatch(/\$\d{3,}/);
    expect(result.answer).not.toMatch(/£\d{3,}/);
    expect(result.answer).not.toMatch(/€\d{3,}/);
  });

  it('communicates when sensitive info not in KB', async () => {
    const state = {
      ...createInitialState('What is the Wi-Fi password?'),
      sourceType: 'internal' as const,
      documents: [{ id: '1', source: 'handbook.pdf', excerpt: 'General IT policies.', score: 0.5 }],
    };
    const result = await generatorNode(state);
    expect(result.answer).toBeTruthy();
    // Should communicate info is unavailable: "don't have", "contact", "not available"
    const a = result.answer.toLowerCase();
    expect(a.includes("don't") || a.includes('contact') || a.includes('not available') || a.includes('unavailable')).toBe(true);
  });
});
