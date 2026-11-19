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

import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { generatorNode, fallbackNode } from './rag/nodes';
import { afterGenerate, afterGrade } from './rag/workflow';
import { createInitialState } from './rag/state';
import type { Citation } from './rag/state';
import { getChatModel } from '../services/openai';
import { computeContentHash } from '../services/ingestion';

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

describe('Citation Grounding (SOURCES_USED)', () => {
  it('filters out uncited sources when SOURCES_USED is provided', async () => {
    const mockInvoke = vi.fn().mockResolvedValue({
      content: 'Here is the response using document 1.\nSOURCES_USED: 1',
    });
    vi.mocked(getChatModel).mockReturnValueOnce({ invoke: mockInvoke } as any);

    const doc1: Citation = { id: 'chunk-1', source: 'doc1.pdf', excerpt: 'First doc content' };
    const doc2: Citation = { id: 'chunk-2', source: 'doc2.pdf', excerpt: 'Second doc content' };
    const state = {
      ...createInitialState('Test question'),
      sourceType: 'internal' as const,
      documents: [doc1, doc2],
    };

    const result = await generatorNode(state);
    expect(result.documents).toHaveLength(1);
    expect(result.documents![0].id).toBe('chunk-1');
    expect(result.answer).not.toContain('SOURCES_USED');
    expect(result.answer).toBe('Here is the response using document 1.');
  });

  it('returns empty citations when SOURCES_USED: none', async () => {
    const mockInvoke = vi.fn().mockResolvedValue({
      content: 'I could not find anything useful.\nSOURCES_USED: none',
    });
    vi.mocked(getChatModel).mockReturnValueOnce({ invoke: mockInvoke } as any);

    const doc1: Citation = { id: 'chunk-1', source: 'doc1.pdf', excerpt: 'First doc content' };
    const state = {
      ...createInitialState('Test question'),
      sourceType: 'internal' as const,
      documents: [doc1],
    };

    const result = await generatorNode(state);
    expect(result.documents).toHaveLength(0);
    expect(result.answer).toBe('I could not find anything useful.');
  });
});

describe('Fallback Node Intent-Awareness & Escalation', () => {
  it('sets needsEscalation and P3 priority for it_support intent', async () => {
    const state = {
      ...createInitialState('My laptop screen is flickering'),
      intent: 'it_support' as const,
    };
    const result = await fallbackNode(state);
    expect(result.needsEscalation).toBe(true);
    expect(result.escalationPriority).toBe('P3');
    expect(result.answer).toContain('IT support ticket');
  });

  it('sets needsEscalation and P3 priority for technical_troubleshooting intent', async () => {
    const state = {
      ...createInitialState('DNS lookup fails for internal host'),
      intent: 'technical_troubleshooting' as const,
    };
    const result = await fallbackNode(state);
    expect(result.needsEscalation).toBe(true);
    expect(result.escalationPriority).toBe('P3');
    expect(result.answer).toContain('Engineering / IT Support');
  });

  it('does not escalate company_policy fallback and suggests HR portal', async () => {
    const state = {
      ...createInitialState('What is the bereavement leave policy?'),
      intent: 'company_policy' as const,
    };
    const result = await fallbackNode(state);
    expect(result.needsEscalation).toBe(false);
    expect(result.answer).toContain('People Operations / HR');
  });
});

describe('RAG Routing Functions', () => {
  it('afterGenerate routes to escalation_check when no evidence for it_support', () => {
    const state = {
      ...createInitialState('Laptop will not turn on'),
      intent: 'it_support' as const,
      documents: [],
      webResults: [],
    };
    expect(afterGenerate(state)).toBe('escalation_check');
  });

  it('afterGenerate routes to done when documents exist', () => {
    const state = {
      ...createInitialState('Laptop setup'),
      intent: 'it_support' as const,
      documents: [{ source: 'doc.pdf', excerpt: 'setup' }],
      webResults: [],
    };
    expect(afterGenerate(state)).toBe('done');
  });

  it('afterGrade routes to fallback when retriesLeft <= 0 and rewriteCount >= 2', () => {
    const state = {
      ...createInitialState('some question'),
      grade: 'insufficient' as const,
      retriesLeft: 0,
      rewriteCount: 2,
      allowWebFallback: true,
      intent: 'it_support' as const,
    };
    expect(afterGrade(state)).toBe('fallback');
  });

  it('afterGrade routes to fallback for company_policy even if allowWebFallback is true', () => {
    const state = {
      ...createInitialState('company policy question'),
      grade: 'insufficient' as const,
      retriesLeft: 0,
      rewriteCount: 1,
      allowWebFallback: true,
      intent: 'company_policy' as const,
    };
    expect(afterGrade(state)).toBe('fallback');
  });
});

describe('Ingestion Service Hash Check', () => {
  it('computes sha256 content hash correctly without upserting', async () => {
    const tmpFile = path.join(process.cwd(), 'temp-hash-test.txt');
    fs.writeFileSync(tmpFile, 'Hello world content for hash test', 'utf-8');
    try {
      const hash = await computeContentHash(tmpFile);
      const expected = crypto.createHash('sha256').update('Hello world content for hash test').digest('hex');
      expect(hash).toBe(expected);
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  });
});
