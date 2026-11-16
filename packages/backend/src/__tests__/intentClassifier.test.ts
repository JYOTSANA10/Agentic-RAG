/**
 * Intent Classifier Unit Tests
 * Uses Vitest module mocking. Mocks must use exact same path as imported in source.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must mock using the exact module path as referenced in nodes.ts source
vi.mock('../services/openai', () => ({
  getChatModel: vi.fn(() => ({
    invoke: vi.fn(async (prompt: string) => {
      // Match on user message content embedded in the prompt
      if (prompt.includes('VPN is not connecting')) return { content: 'it_support' };
      if (prompt.includes('annual leave policy')) return { content: 'company_policy' };
      if (prompt.includes('troubleshoot a DNS')) return { content: 'technical_troubleshooting' };
      if (prompt.includes('Teams currently experiencing an outage')) return { content: 'external_information' };
      if (prompt.includes('MFA') || prompt.includes('laptop')) return { content: 'it_support' };
      return { content: 'unknown' };
    }),
  })),
}));

vi.mock('../services/pinecone', () => ({
  retrieveChunks: vi.fn(async () => []),
}));

vi.mock('../services/tavily', () => ({
  searchWeb: vi.fn(async () => []),
}));

import { intentClassifierNode } from './rag/nodes';
import { createInitialState } from './rag/state';

describe('Intent Classifier — Keyword Fast-Path', () => {
  it('classifies "hello" as greeting', async () => {
    const state = createInitialState('hello');
    const result = await intentClassifierNode(state);
    expect(result.intent).toBe('greeting');
  });

  it('classifies "hi" as greeting', async () => {
    const state = createInitialState('hi');
    const result = await intentClassifierNode(state);
    expect(result.intent).toBe('greeting');
  });

  it('classifies "good morning" as greeting', async () => {
    const state = createInitialState('good morning');
    const result = await intentClassifierNode(state);
    expect(result.intent).toBe('greeting');
  });

  it('classifies "thank you" as greeting', async () => {
    const state = createInitialState('thank you');
    const result = await intentClassifierNode(state);
    expect(result.intent).toBe('greeting');
  });

  it('classifies "goodbye" as greeting', async () => {
    const state = createInitialState('goodbye');
    const result = await intentClassifierNode(state);
    expect(result.intent).toBe('greeting');
  });

  it('classifies "how are you?" as general_conversation', async () => {
    const state = createInitialState('how are you?');
    const result = await intentClassifierNode(state);
    expect(result.intent).toBe('general_conversation');
  });

  it('classifies "what can you do?" as general_conversation', async () => {
    const state = createInitialState('what can you do?');
    const result = await intentClassifierNode(state);
    expect(result.intent).toBe('general_conversation');
  });
});

describe('Intent Classifier — LLM Classification', () => {
  it('classifies VPN question as it_support', async () => {
    const state = createInitialState('My VPN is not connecting after multiple attempts');
    const result = await intentClassifierNode(state);
    expect(result.intent).toBe('it_support');
  });

  it('classifies leave question as company_policy', async () => {
    const state = createInitialState('What is our annual leave policy?');
    const result = await intentClassifierNode(state);
    expect(result.intent).toBe('company_policy');
  });

  it('classifies DNS troubleshooting as technical_troubleshooting', async () => {
    const state = createInitialState('How do I troubleshoot a DNS issue?');
    const result = await intentClassifierNode(state);
    expect(result.intent).toBe('technical_troubleshooting');
  });

  it('classifies service outage query as external_information', async () => {
    const state = createInitialState('Is Microsoft Teams currently experiencing an outage?');
    const result = await intentClassifierNode(state);
    expect(result.intent).toBe('external_information');
  });
});

describe('Intent Classifier — Trace Recording', () => {
  it('adds exactly one trace step', async () => {
    const state = createInitialState('hello');
    const result = await intentClassifierNode(state);
    expect(result.trace).toHaveLength(1);
  });

  it('trace step has correct node name', async () => {
    const state = createInitialState('hello');
    const result = await intentClassifierNode(state);
    expect(result.trace![0].step).toBe('Intent Classifier');
  });

  it('trace status is done', async () => {
    const state = createInitialState('hi');
    const result = await intentClassifierNode(state);
    expect(result.trace![0].status).toBe('done');
  });

  it('trace records intent label for greeting', async () => {
    const state = createInitialState('hi');
    const result = await intentClassifierNode(state);
    expect(result.trace![0].detail).toContain('Greeting');
  });

  it('trace records durationMs as a number', async () => {
    const state = createInitialState('hello');
    const result = await intentClassifierNode(state);
    expect(typeof result.trace![0].durationMs).toBe('number');
  });
});

describe('State defaults', () => {
  it('createInitialState sets correct defaults', () => {
    const state = createInitialState('test question');
    expect(state.intent).toBe('unknown');
    expect(state.retriesLeft).toBe(1);
    expect(state.allowWebFallback).toBe(true);
    expect(state.needsEscalation).toBe(false);
    expect(state.escalationPriority).toBeNull();
    expect(state.documents).toHaveLength(0);
    expect(state.webResults).toHaveLength(0);
    expect(state.grade).toBe('pending');
    expect(state.sourceType).toBe('none');
  });

  it('createInitialState respects allowWebFallback=false', () => {
    const state = createInitialState('test question', false);
    expect(state.allowWebFallback).toBe(false);
  });

  it('createInitialState sets question and rewrittenQuery', () => {
    const q = 'Is MFA mandatory?';
    const state = createInitialState(q);
    expect(state.question).toBe(q);
    expect(state.rewrittenQuery).toBe(q);
  });
});
