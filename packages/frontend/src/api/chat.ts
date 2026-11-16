import api from './client';

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

export interface ChatResponse {
  conversationId: string;
  messageId: string;
  answer: string;
  sourceType: 'internal' | 'web' | 'none';
  intent: IntentType;
  citations: Citation[];
  trace: TraceStep[];
  needsEscalation: boolean;
  escalationPriority: 'P1' | 'P2' | 'P3' | 'P4' | null;
  latencyMs: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sourceType?: string;
  intent?: IntentType;
  citations: Citation[];
  traceSteps: TraceStep[];
  needsEscalation?: boolean;
  escalationPriority?: 'P1' | 'P2' | 'P3' | 'P4' | null;
  createdAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages?: Message[];
}

export async function sendChat(
  question: string,
  conversationId?: string,
  allowWebFallback = true,
): Promise<ChatResponse> {
  const { data } = await api.post<ChatResponse>('/chat', { question, conversationId, allowWebFallback });
  return data;
}

export async function getConversations(): Promise<Conversation[]> {
  const { data } = await api.get<{ conversations: Conversation[] }>('/chat/conversations');
  return data.conversations;
}

export async function getConversation(id: string): Promise<Conversation> {
  const { data } = await api.get<{ conversation: Conversation }>(`/chat/conversations/${id}`);
  return data.conversation;
}
