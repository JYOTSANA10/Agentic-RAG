export type IntentType =
  | 'greeting'
  | 'general_conversation'
  | 'it_support'
  | 'company_policy'
  | 'technical_troubleshooting'
  | 'external_information'
  | 'unknown';

export interface Citation {
  id?: string;
  source: string;
  excerpt: string;
  score?: number;
  url?: string;
}

export interface TraceStep {
  step: string;
  detail: string;
  status: 'running' | 'done' | 'skipped' | 'error';
  durationMs?: number;
  timestamp: number;
}

export interface AgentState {
  question: string;
  intent: IntentType;
  rewrittenQuery: string;
  documents: Citation[];
  webResults: Citation[];
  grade: 'sufficient' | 'insufficient' | 'pending';
  sourceType: 'internal' | 'web' | 'none';
  answer: string;
  trace: TraceStep[];
  retriesLeft: number;
  allowWebFallback: boolean;
  needsEscalation: boolean;
  escalationPriority: 'P1' | 'P2' | 'P3' | 'P4' | null;
  /** Number of times the query has been rewritten (for retry-guard logic) */
  rewriteCount: number;
}

export function createInitialState(question: string, allowWebFallback = true): AgentState {
  return {
    question,
    intent: 'unknown',
    rewrittenQuery: question,
    documents: [],
    webResults: [],
    grade: 'pending',
    sourceType: 'none',
    answer: '',
    trace: [],
    retriesLeft: 1,
    allowWebFallback,
    needsEscalation: false,
    escalationPriority: null,
    rewriteCount: 0,
  };
}
