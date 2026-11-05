import api from './client';

export interface Citation { source: string; excerpt: string; score?: number; url?: string; }
export interface TraceStep { step: string; detail: string; timestamp: number; }

export interface ChatResponse {
  conversationId: string;
  messageId: string;
  answer: string;
  sourceType: 'internal' | 'web' | 'none';
  citations: Citation[];
  trace: TraceStep[];
  latencyMs: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sourceType?: string;
  citations: Citation[];
  traceSteps: TraceStep[];
  createdAt: string;
}

export interface Conversation {
  id: string; title: string; createdAt: string; updatedAt: string; messages?: Message[];
}

export async function sendChat(question: string, conversationId?: string, allowWebFallback = true): Promise<ChatResponse> {
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

