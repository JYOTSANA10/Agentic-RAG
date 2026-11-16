/**
 * Evidence Grader, Retriever, Rewriter, Web Search — Unit Tests
 * All external services mocked. Mocks use same path as source imports.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockPineconeChunks: any[] = [];
let mockTavilyResults: any[] = [];

vi.mock('../services/openai', () => ({
  getChatModel: vi.fn(() => ({
    invoke: vi.fn(async (prompt: string) => {
      // Grader asks: Respond with ONLY "YES" or "NO"
      if (prompt.includes('"YES" or "NO"') || prompt.includes('YES or NO') || prompt.includes('Respond with ONLY')) {
        return { content: 'YES' };
      }
      if (prompt.includes('ESCALATE')) return { content: 'ESCALATE:NO' };
      if (prompt.includes('Rephrased:')) return { content: 'annual leave policy carry forward' };
      if (prompt.includes('Answer:')) return { content: 'Based on company policy, here is the answer.' };
      return { content: 'it_support' };
    }),
  })),
}));

vi.mock('../services/pinecone', () => ({
  retrieveChunks: vi.fn(async () => mockPineconeChunks),
}));

vi.mock('../services/tavily', () => ({
  searchWeb: vi.fn(async () => mockTavilyResults),
}));

import { graderNode, retrieverNode, rewriterNode, webSearchNode } from './rag/nodes';
import { createInitialState } from './rag/state';

// ── Evidence Grader ───────────────────────────────────────────────────────────
describe('Evidence Grader', () => {
  it('returns insufficient when no documents', async () => {
    const state = { ...createInitialState('test'), documents: [] };
    const result = await graderNode(state);
    expect(result.grade).toBe('insufficient');
  });

  it('filters out low-score chunks below 0.3 threshold', async () => {
    const state = {
      ...createInitialState('test'),
      documents: [
        { id: '1', source: 'doc.pdf', excerpt: 'some content', score: 0.1 },
        { id: '2', source: 'doc.pdf', excerpt: 'other content', score: 0.2 },
      ],
    };
    const result = await graderNode(state);
    expect(result.grade).toBe('insufficient');
    expect(result.trace![0].detail).toContain('below relevance threshold');
  });

  it('grades as sufficient when LLM says YES', async () => {
    const state = {
      ...createInitialState('What is sick leave policy?'),
      documents: [
        { id: '1', source: 'handbook.pdf', excerpt: 'Sick leave is 10 days per year.', score: 0.85 },
      ],
    };
    const result = await graderNode(state);
    expect(result.grade).toBe('sufficient');
    expect(result.sourceType).toBe('internal');
  });

  it('adds trace step named Evidence Grader', async () => {
    const state = { ...createInitialState('test'), documents: [] };
    const result = await graderNode(state);
    expect(result.trace).toHaveLength(1);
    expect(result.trace![0].step).toBe('Evidence Grader');
  });

  it('trace step has durationMs', async () => {
    const state = { ...createInitialState('test'), documents: [] };
    const result = await graderNode(state);
    expect(typeof result.trace![0].durationMs).toBe('number');
  });
});

// ── Retriever ─────────────────────────────────────────────────────────────────
describe('Retriever', () => {
  beforeEach(() => {
    mockPineconeChunks = [
      { id: 'chunk-1', text: 'Sick leave accrues at 10 days per year.', source: 'handbook.pdf', score: 0.9 },
      { id: 'chunk-2', text: 'Annual leave policy details.', source: 'handbook.pdf', score: 0.85 },
      { id: 'chunk-1', text: 'Sick leave accrues at 10 days per year.', source: 'handbook.pdf', score: 0.9 }, // duplicate
    ];
  });

  it('deduplicates chunks by id — returns 2 from 3', async () => {
    // Reset mock to return our chunks
    const { retrieveChunks } = await import('../services/pinecone');
    vi.mocked(retrieveChunks).mockResolvedValueOnce(mockPineconeChunks);

    const state = createInitialState('sick leave policy');
    const result = await retrieverNode(state);
    expect(result.documents).toHaveLength(2);
  });

  it('uses rewrittenQuery over question', async () => {
    const { retrieveChunks } = await import('../services/pinecone');
    vi.mocked(retrieveChunks).mockResolvedValueOnce([]);
    const state = { ...createInitialState('sick days'), rewrittenQuery: 'sick leave accrual policy' };
    await retrieverNode(state);
    expect(retrieveChunks).toHaveBeenCalledWith('sick leave accrual policy', 5);
  });

  it('handles Pinecone error gracefully', async () => {
    const { retrieveChunks } = await import('../services/pinecone');
    vi.mocked(retrieveChunks).mockRejectedValueOnce(new Error('Pinecone timeout'));
    const state = createInitialState('test query');
    const result = await retrieverNode(state);
    expect(result.documents).toHaveLength(0);
    expect(result.grade).toBe('insufficient');
    expect(result.trace![0].status).toBe('error');
  });

  it('adds Retriever trace step', async () => {
    const { retrieveChunks } = await import('../services/pinecone');
    vi.mocked(retrieveChunks).mockResolvedValueOnce([]);
    const state = createInitialState('test');
    const result = await retrieverNode(state);
    expect(result.trace![0].step).toBe('Retriever');
  });
});

// ── Query Rewriter ────────────────────────────────────────────────────────────
describe('Query Rewriter', () => {
  it('decrements retriesLeft by 1', async () => {
    const state = { ...createInitialState('what happens when I leave?'), retriesLeft: 1 };
    const result = await rewriterNode(state);
    expect(result.retriesLeft).toBe(0);
  });

  it('adds Query Rewriter trace step', async () => {
    const state = { ...createInitialState('sick days?'), retriesLeft: 1 };
    const result = await rewriterNode(state);
    expect(result.trace).toHaveLength(1);
    expect(result.trace![0].step).toBe('Query Rewriter');
  });

  it('sets rewrittenQuery as a non-empty string', async () => {
    const state = { ...createInitialState('do I get sick days next year?'), retriesLeft: 1 };
    const result = await rewriterNode(state);
    expect(result.rewrittenQuery).toBeTruthy();
    expect(typeof result.rewrittenQuery).toBe('string');
  });
});

// ── Web Search Node ───────────────────────────────────────────────────────────
describe('Web Search Node', () => {
  it('handles Tavily error gracefully', async () => {
    const { searchWeb } = await import('../services/tavily');
    vi.mocked(searchWeb).mockRejectedValueOnce(new Error('Tavily rate limit'));
    const state = createInitialState('Microsoft Teams outage');
    const result = await webSearchNode(state);
    expect(result.webResults).toHaveLength(0);
    expect(result.trace![0].status).toBe('error');
  });

  it('maps Tavily results to citations with url', async () => {
    const { searchWeb } = await import('../services/tavily');
    vi.mocked(searchWeb).mockResolvedValueOnce([
      { title: 'Teams Status', content: 'Teams is experiencing issues.', url: 'https://status.microsoft.com', score: 0.9 },
    ]);
    const state = createInitialState('Microsoft Teams outage');
    const result = await webSearchNode(state);
    expect(result.webResults).toHaveLength(1);
    expect(result.webResults![0].url).toBe('https://status.microsoft.com');
    expect(result.webResults![0].source).toBe('Teams Status');
  });

  it('handles Tavily returning no results', async () => {
    const { searchWeb } = await import('../services/tavily');
    vi.mocked(searchWeb).mockResolvedValueOnce([]);
    const state = createInitialState('some query');
    const result = await webSearchNode(state);
    expect(result.webResults).toHaveLength(0);
  });

  it('adds Web Search trace step', async () => {
    const { searchWeb } = await import('../services/tavily');
    vi.mocked(searchWeb).mockResolvedValueOnce([]);
    const state = createInitialState('test');
    const result = await webSearchNode(state);
    expect(result.trace![0].step).toBe('Web Search');
  });
});
