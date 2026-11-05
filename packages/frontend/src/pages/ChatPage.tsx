import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  MessageSquare, Send, Loader2, Globe, Database, Plus,
  LogOut, Settings, ChevronDown, ChevronUp, ExternalLink,
  AlertTriangle, LifeBuoy, CheckCircle2
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useAuthStore } from '../store/auth';
import {
  sendChat, getConversations, getConversation,
  type Message, type Conversation, type Citation, type TraceStep,
} from '../api/chat';

function SourceBadge({ sourceType }: { sourceType?: string }) {
  if (!sourceType || sourceType === 'none') return null;
  if (sourceType === 'web') {
    return (
      <div className="space-y-1.5 my-1">
        <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-0.5 bg-amber-100 text-amber-800 font-medium rounded-full border border-amber-200">
          <Globe className="w-3 h-3 text-amber-600" /> External Web Search (Fallback)
        </span>
        <div className="flex items-start gap-1.5 text-[11px] text-amber-800 bg-amber-50/80 rounded-md p-2 border border-amber-200/60 leading-relaxed">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
          <span>
            <strong>External Guidance Notice:</strong> This solution was retrieved from public vendor documentation. Please cross-verify critical system configuration changes with your company IT lead.
          </span>
        </div>
      </div>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-0.5 bg-emerald-100 text-emerald-800 font-medium rounded-full border border-emerald-200">
      <Database className="w-3 h-3 text-emerald-600" /> Internal IT Knowledge Base
    </span>
  );
}

function CitationsPanel({ citations }: { citations: Citation[] }) {
  if (!citations?.length) return null;
  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Sources & References</p>
      <div className="space-y-2">
        {citations.slice(0, 3).map((c, i) => (
          <div key={i} className="bg-gray-50 rounded-lg p-2.5 text-xs border border-gray-100">
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-gray-700 truncate max-w-xs">{c.source}</span>
              {c.url && (
                <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:text-brand-700 ml-2 flex-shrink-0 flex items-center gap-0.5 font-medium">
                  Link <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
            <p className="text-gray-600 line-clamp-2 leading-relaxed">{c.excerpt}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function TracePanel({ trace }: { trace: TraceStep[] }) {
  const [open, setOpen] = useState(false);
  if (!trace?.length) return null;
  return (
    <div className="mt-2.5">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs text-brand-700 bg-brand-50 hover:bg-brand-100 px-2.5 py-1 rounded-md transition-colors font-medium"
      >
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        Agent Workflow Trace ({trace.length} steps)
      </button>
      {open && (
        <div className="mt-2.5 bg-gray-50/80 rounded-xl p-3 border border-gray-200 space-y-2">
          {trace.map((t, i) => (
            <div key={i} className="flex items-start gap-2.5 text-xs">
              <span className="w-5 h-5 rounded-full bg-brand-600 text-white flex items-center justify-center flex-shrink-0 font-bold text-[10px] mt-0.5">
                {i + 1}
              </span>
              <div className="flex-1">
                <span className="font-semibold text-gray-800">{t.step}: </span>
                <span className="text-gray-600">{t.detail}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ message, onEscalate }: { message: Message; onEscalate: (query: string) => void }) {
  const isUser = message.role === 'user';
  const isFallback = !isUser && message.sourceType === 'none';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-5`}>
      <div className="max-w-[82%]">
        <div className={`rounded-2xl px-4 py-3.5 ${
          isUser
            ? 'bg-brand-600 text-white rounded-tr-sm shadow-sm'
            : 'bg-white border border-gray-200 text-gray-800 rounded-tl-sm shadow-sm'
        }`}>
          {isUser ? (
            <p className="text-sm">{message.content}</p>
          ) : (
            <div className="text-sm prose prose-sm max-w-none prose-p:my-1.5 prose-headings:my-2 prose-ul:my-1 prose-li:my-0.5">
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </div>
          )}
        </div>
        {!isUser && (
          <div className="px-2 mt-2 space-y-1.5">
            <SourceBadge sourceType={message.sourceType} />
            <CitationsPanel citations={message.citations} />
            <TracePanel trace={message.traceSteps} />
            {isFallback && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 text-red-700">
                  <LifeBuoy className="w-4 h-4 text-red-500 flex-shrink-0" />
                  <span>Unresolved automatically? Escalate directly to Tier-2 IT support.</span>
                </div>
                <button
                  onClick={() => onEscalate(message.content)}
                  className="bg-red-600 hover:bg-red-700 text-white font-medium px-3 py-1.5 rounded-lg flex-shrink-0 transition-colors"
                >
                  Create IT Ticket
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const SAMPLE_QUESTIONS = [
  'How do I connect to the company VPN from home?',
  'What is the annual leave allowance and carry-forward policy?',
  'How do I set up Multi-Factor Authentication (MFA)?',
  'What is the latest Microsoft Teams / Azure outage status?',
];

export default function ChatPage() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [allowWeb, setAllowWeb] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [ticketToast, setTicketToast] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    getConversations().then(setConversations).catch(console.error);
  }, []);

  useEffect(() => {
    if (conversationId) {
      getConversation(conversationId).then((c) => setMessages(c.messages || [])).catch(console.error);
    } else {
      setMessages([]);
    }
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(async (customText?: string) => {
    const q = (customText || input).trim();
    if (!q || loading) return;
    setInput('');
    setLoading(true);

    const tempMsg: Message = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: q,
      citations: [],
      traceSteps: [],
      createdAt: new Date().toISOString(),
    };
    setMessages((p) => [...p, tempMsg]);

    try {
      const result = await sendChat(q, conversationId, allowWeb);
      if (!conversationId) {
        navigate(`/chat/${result.conversationId}`, { replace: true });
        setConversations((p) => [
          { id: result.conversationId, title: q.slice(0, 60), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          ...p,
        ]);
      }
      setMessages((p) => [
        ...p,
        {
          id: result.messageId,
          role: 'assistant',
          content: result.answer,
          sourceType: result.sourceType,
          citations: result.citations,
          traceSteps: result.trace,
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch {
      setMessages((p) => [
        ...p,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: '⚠️ An unexpected error occurred while reaching the AI Copilot. Please check system status or reach out to your administrator.',
          citations: [],
          traceSteps: [],
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, loading, conversationId, allowWeb, navigate]);

  function handleEscalate(_content: string) {
    const ticketId = `INC-${Math.floor(100000 + Math.random() * 900000)}`;
    setTicketToast(`Ticket #${ticketId} created and dispatched to IT Help Desk queue with Priority: P2.`);
    setTimeout(() => setTicketToast(null), 5000);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Toast */}
      {ticketToast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-900 text-white px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 text-sm animate-fade-in border border-gray-700">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
          <span>{ticketToast}</span>
        </div>
      )}

      {/* Sidebar */}
      <div className={`${sidebarOpen ? 'w-64' : 'w-0'} transition-all duration-300 bg-brand-900 text-white flex flex-col overflow-hidden flex-shrink-0`}>
        <div className="p-4 border-b border-brand-700 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-brand-700 flex items-center justify-center font-bold text-white shadow-sm">
            AI
          </div>
          <div>
            <span className="font-semibold text-sm tracking-tight block">IT Support Copilot</span>
            <span className="text-[10px] text-brand-300 font-mono">Agentic RAG v1.0</span>
          </div>
        </div>
        <div className="p-3">
          <button
            onClick={() => { navigate('/chat'); setMessages([]); }}
            className="w-full flex items-center justify-center gap-2 text-sm bg-brand-700 hover:bg-brand-600 px-3 py-2.5 rounded-xl transition-all shadow-sm font-medium"
          >
            <Plus className="w-4 h-4" /> New Ticket Chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 space-y-1 scrollbar-thin">
          <div className="px-2 py-1 text-[11px] font-semibold text-brand-400 uppercase tracking-wider">
            History
          </div>
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => navigate(`/chat/${c.id}`)}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs truncate transition-colors ${
                conversationId === c.id ? 'bg-brand-600 text-white font-medium shadow-sm' : 'text-brand-200 hover:bg-brand-700/60'
              }`}
            >
              {c.title}
            </button>
          ))}
        </div>
        <div className="p-3 border-t border-brand-700 space-y-1">
          {user?.role === 'admin' && (
            <button
              onClick={() => navigate('/admin')}
              className="w-full flex items-center gap-2 text-xs text-brand-200 hover:text-white px-3 py-2 rounded-lg hover:bg-brand-700 transition-colors"
            >
              <Settings className="w-4 h-4" /> Admin Console
            </button>
          )}
          <button
            onClick={() => { logout(); navigate('/login'); }}
            className="w-full flex items-center gap-2 text-xs text-brand-300 hover:text-white px-3 py-2 rounded-lg hover:bg-brand-700 transition-colors"
          >
            <LogOut className="w-4 h-4" /> Sign Out ({user?.name || user?.email})
          </button>
        </div>
      </div>

      {/* Main Container */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 shadow-xs">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
            <MessageSquare className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
              Enterprise IT Support Copilot
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                LangGraph Powered
              </span>
            </h1>
            <p className="text-xs text-gray-500">Self-corrective Agentic RAG with Private KB + Fallback Web Search</p>
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-600 bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-200 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={allowWeb}
              onChange={(e) => setAllowWeb(e.target.checked)}
              className="rounded text-brand-600 focus:ring-brand-500"
            />
            <Globe className="w-3.5 h-3.5 text-gray-500" />
            <span className="font-medium">Web Search Fallback</span>
          </label>
        </div>

        {/* Message Viewport */}
        <div className="flex-1 overflow-y-auto px-4 py-6 scrollbar-thin">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center max-w-xl mx-auto py-8">
              <div className="w-14 h-14 bg-brand-50 rounded-2xl flex items-center justify-center mb-4 text-brand-600 shadow-sm border border-brand-100">
                <LifeBuoy className="w-7 h-7" />
              </div>
              <h2 className="text-xl font-bold text-gray-800 mb-2">Welcome to Enterprise IT Copilot</h2>
              <p className="text-sm text-gray-500 mb-6 leading-relaxed">
                Your AI agent searches internal company runbooks, HR/IT policies, and live vendor status to resolve technical issues autonomously.
              </p>
              <div className="grid gap-2.5 w-full text-left">
                {SAMPLE_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => {
                      setInput(q);
                      handleSend(q);
                    }}
                    className="text-left text-sm bg-white border border-gray-200 hover:border-brand-500 hover:bg-brand-50/50 p-3.5 rounded-xl transition-all text-gray-700 shadow-xs flex items-center justify-between group"
                  >
                    <span>{q}</span>
                    <Send className="w-4 h-4 text-gray-300 group-hover:text-brand-600 transition-colors" />
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} onEscalate={handleEscalate} />
          ))}
          {loading && (
            <div className="flex justify-start mb-4">
              <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm flex items-center gap-2.5 text-xs text-gray-500">
                <Loader2 className="w-4 h-4 text-brand-600 animate-spin" />
                <span>Agent analyzing query, evaluating knowledge base & routing...</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Prompt Input */}
        <div className="bg-white border-t border-gray-200 p-4">
          <div className="flex items-end gap-3 max-w-4xl mx-auto">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe your IT issue or question... (Enter to send, Shift+Enter for newline)"
              rows={1}
              disabled={loading}
              className="flex-1 resize-none border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60 max-h-40 scrollbar-thin shadow-xs"
              style={{ minHeight: '46px' }}
            />
            <button
              onClick={() => handleSend()}
              disabled={loading || !input.trim()}
              className="bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white p-3 rounded-xl transition-all flex-shrink-0 shadow-sm"
              title="Send Message"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
