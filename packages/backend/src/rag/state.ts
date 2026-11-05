export interface Citation {
  source: string;
  excerpt: string;
  score?: number;
  url?: string;
}

export interface TraceStep {
  step: string;
  detail: string;
  timestamp: number;
}

export interface AgentState {
  question: string;
  rewrittenQuery: string;
  documents: Citation[];
  webResults: Citation[];
  grade: 'sufficient' | 'insufficient' | 'pending';
  sourceType: 'internal' | 'web' | 'none';
  answer: string;
  trace: TraceStep[];
  retriesLeft: number;
  allowWebFallback: boolean;
}

export function createInitialState(question: string, allowWebFallback = true): AgentState {
  return {
    question,
    rewrittenQuery: question,
    documents: [],
    webResults: [],
    grade: 'pending',
    sourceType: 'none',
    answer: '',
    trace: [],
    retriesLeft: 1,
    allowWebFallback,
  };
}

