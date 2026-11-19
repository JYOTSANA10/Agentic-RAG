import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  MessageSquare, Send, Loader2, Globe, Database, Plus,
  LogOut, Settings, ChevronDown, ChevronUp, ExternalLink,
  AlertTriangle, LifeBuoy, CheckCircle2, Copy, Check,
  ThumbsUp, ThumbsDown, Clock, Layers, RefreshCw, Tag,
  Ticket,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useAuthStore } from '../store/auth';
import {
  sendChat, getConversations, getConversation,
  type Message, type Conversation, type Citation, type TraceStep, type IntentType,
} from '../api/chat';
import { createTicket, getMyTickets, type Ticket as TicketData } from '../api/tickets';

// ── Intent badge ──────────────────────────────────────────────────────────────
const INTENT_LABELS: Record<IntentType, { label: string; color: string }> = {
  greeting:                { label: 'Greeting',           color: 'bg-sky-100 text-sky-700 border-sky-200' },
  general_conversation:    { label: 'General Chat',       color: 'bg-purple-100 text-purple-700 border-purple-200' },
  it_support:              { label: 'IT Support',         color: 'bg-blue-100 text-blue-700 border-blue-200' },
  company_policy:          { label: 'Company Policy',     color: 'bg-green-100 text-green-700 border-green-200' },
  technical_troubleshooting: { label: 'Technical',       color: 'bg-orange-100 text-orange-700 border-orange-200' },
  external_information:    { label: 'External Info',      color: 'bg-amber-100 text-amber-700 border-amber-200' },
  unknown:                 { label: 'Unknown',            color: 'bg-gray-100 text-gray-600 border-gray-200' },
};

function IntentBadge({ intent }: { intent?: IntentType }) {
  if (!intent) return null;
  const cfg = INTENT_LABELS[intent] || INTENT_LABELS.unknown;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-semibold ${cfg.color}`}>
      <Tag className="w-2.5 h-2.5" />{cfg.label}
    </span>
  );
}

// ── Source badge ──────────────────────────────────────────────────────────────
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
            <strong>External Guidance Notice:</strong> This answer uses public web sources. Cross-verify critical changes with your IT lead.
          </span>
        </div>
      </div>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-0.5 bg-emerald-100 text-emerald-800 font-medium rounded-full border border-emerald-200">
      <Database className="w-3 h-3 text-emerald-600" /> Internal Knowledge Base
    </span>
  );
}

// ── Citations panel (deduped) ─────────────────────────────────────────────────
function CitationsPanel({ citations, sourceType }: { citations: Citation[]; sourceType?: string }) {
  // Never show citations for non-retrieval responses
  if (!citations?.length || !sourceType || sourceType === 'none') return null;

  // Deduplicate by source name on the frontend as a safety net
  const seen = new Set<string>();
  const unique = citations.filter((c) => {
    const key = c.id || `${c.source}::${c.excerpt.slice(0, 60)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (!unique.length) return null;

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
        <Layers className="w-3 h-3" /> Sources & References ({unique.length})
      </p>
      <div className="space-y-2">
        {unique.slice(0, 4).map((c, i) => (
          <div key={i} className="bg-gray-50 rounded-lg p-2.5 text-xs border border-gray-100">
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-gray-700 truncate max-w-xs">{c.source}</span>
              <div className="flex items-center gap-2 flex-shrink-0">
                {c.score !== undefined && (
                  <span className="text-[10px] text-gray-400 font-mono">score: {c.score.toFixed(3)}</span>
                )}
                {c.url && (
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-600 hover:text-brand-700 ml-1 flex items-center gap-0.5 font-medium"
                  >
                    Link <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
            <p className="text-gray-600 line-clamp-3 leading-relaxed">{c.excerpt}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Agent trace panel ─────────────────────────────────────────────────────────
const STEP_STATUS_ICONS: Record<TraceStep['status'], React.ReactNode> = {
  done:    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />,
  skipped: <span className="w-3.5 h-3.5 rounded-full border-2 border-gray-300 inline-block" />,
  running: <Loader2 className="w-3.5 h-3.5 text-brand-600 animate-spin" />,
  error:   <AlertTriangle className="w-3.5 h-3.5 text-red-500" />,
};

function TracePanel({ trace }: { trace: TraceStep[] }) {
  const [open, setOpen] = useState(false);
  if (!trace?.length) return null;

  const totalMs = trace.reduce((sum, t) => sum + (t.durationMs ?? 0), 0);

  return (
    <div className="mt-2.5">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs text-brand-700 bg-brand-50 hover:bg-brand-100 px-2.5 py-1 rounded-md transition-colors font-medium"
      >
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        Agent Trace ({trace.length} steps{totalMs > 0 ? ` · ${totalMs}ms` : ''})
      </button>
      {open && (
        <div className="mt-2.5 bg-gray-50/80 rounded-xl p-3 border border-gray-200 space-y-2">
          {trace.map((t, i) => (
            <div key={i} className="flex items-start gap-2.5 text-xs">
              <div className="flex-shrink-0 mt-0.5">
                {STEP_STATUS_ICONS[t.status ?? 'done']}
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-gray-800">{t.step}: </span>
                <span className="text-gray-600">{t.detail}</span>
                {t.durationMs !== undefined && (
                  <span className="ml-2 text-[10px] text-gray-400 font-mono">{t.durationMs}ms</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Copy button ───────────────────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
      title="Copy answer"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

// ── Escalation banner ─────────────────────────────────────────────────────────
const PRIORITY_COLORS = {
  P1: 'bg-red-600',
  P2: 'bg-orange-500',
  P3: 'bg-yellow-500',
  P4: 'bg-gray-400',
};
const PRIORITY_LABELS = {
  P1: 'P1 – Critical',
  P2: 'P2 – High',
  P3: 'P3 – Standard',
  P4: 'P4 – Low',
};

function EscalationBanner({
  message,
  onEscalate,
  isLoading,
}: {
  message: Message;
  onEscalate: (msg: Message) => void;
  isLoading: boolean;
}) {
  // Only show EscalationBanner when:
  // (message.needsEscalation === true) OR (message.sourceType === 'none' AND (message.intent === 'it_support' OR message.intent === 'technical_troubleshooting'))
  const showEscalate =
    message.needsEscalation === true ||
    (
      message.sourceType === 'none' &&
      (message.intent === 'it_support' || message.intent === 'technical_troubleshooting')
    );

  if (!showEscalate) return null;

  const priority = message.escalationPriority ?? 'P3';
  const priorityColor = PRIORITY_COLORS[priority];
  const priorityLabel = PRIORITY_LABELS[priority];

  return (
    <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between gap-3 text-xs">
      <div className="flex items-center gap-2 text-red-700">
        <LifeBuoy className="w-4 h-4 text-red-500 flex-shrink-0" />
        <span>
          Couldn't resolve automatically? Escalate to IT Support.{' '}
          <span className={`text-white text-[10px] px-1.5 py-0.5 rounded font-bold ${priorityColor}`}>
            {priorityLabel}
          </span>
        </span>
      </div>
      <button
        onClick={() => onEscalate(message)}
        disabled={isLoading}
        className="bg-red-600 hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium px-3 py-1.5 rounded-lg flex-shrink-0 transition-colors flex items-center gap-1.5"
      >
        <Ticket className="w-3.5 h-3.5" />
        {isLoading ? 'Creating...' : 'Create IT Ticket'}
      </button>
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────
function MessageBubble({
  message,
  onEscalate,
  ticketLoading,
}: {
  message: Message;
  onEscalate: (msg: Message) => void;
  ticketLoading: Set<string>;
}) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-5`}>
      <div className="max-w-[82%]">
        <div
          className={`rounded-2xl px-4 py-3.5 ${
            isUser
              ? 'bg-brand-600 text-white rounded-tr-sm shadow-sm'
              : 'bg-white border border-gray-200 text-gray-800 rounded-tl-sm shadow-sm'
          }`}
        >
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
            {/* Meta row: intent badge + copy + latency */}
            <div className="flex items-center gap-2 flex-wrap">
              <IntentBadge intent={message.intent} />
              <CopyButton text={message.content} />
            </div>

            {/* Source badge — only for retrieval results */}
            <SourceBadge sourceType={message.sourceType} />

            {/* Citations — only when retrieval happened */}
            <CitationsPanel citations={message.citations} sourceType={message.sourceType} />

            {/* Trace */}
            <TracePanel trace={message.traceSteps} />

            {/* Escalation banner */}
            <EscalationBanner
              message={message}
              onEscalate={onEscalate}
              isLoading={ticketLoading.has(message.id)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sample questions ──────────────────────────────────────────────────────────
const SAMPLE_QUESTIONS = [
  'Is MFA mandatory for all employees?',
  'What is the annual leave carry-forward policy?',
  'How do I set up the company VPN from home?',
  'What is the latest Microsoft Teams service status?',
];

// ── Main page ─────────────────────────────────────────────────────────────────
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
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [ticketLoading, setTicketLoading] = useState<Set<string>>(new Set());
  const [myTickets, setMyTickets] = useState<TicketData[] | null>(null);
  const [ticketsLoading, setTicketsLoading] = useState(false);
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
          intent: result.intent,
          citations: result.citations,
          traceSteps: result.trace,
          needsEscalation: result.needsEscalation,
          escalationPriority: result.escalationPriority,
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number } };
      let errorMsg = '⚠️ An unexpected error occurred. Please try again.';
      if (axiosErr?.response?.status === 500) {
        errorMsg = '⚠️ The AI service encountered an error. Please try again in a moment.';
      } else if (!axiosErr?.response) {
        errorMsg = '⚠️ Network error. Please check your connection and try again.';
      }
      setMessages((p) => [...p, { id: `err-${Date.now()}`, role: 'assistant', content: errorMsg, citations: [], traceSteps: [], createdAt: new Date().toISOString() }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, loading, conversationId, allowWeb, navigate]);

  const handleEscalate = useCallback(async (msg: Message) => {
    // Prevent double-submission
    if (ticketLoading.has(msg.id)) return;

    setTicketLoading((prev) => new Set(prev).add(msg.id));

    try {
      const ticket = await createTicket({
        question: msg.content,
        description: `IT issue reported via AI Copilot. Intent: ${msg.intent || 'unknown'}`,
        priority: msg.escalationPriority || 'P3',
      });
      const priority = ticket.priority ?? 'P3';
      setTicketToast(`Ticket #${ticket.ticketRef} created · Priority: ${priority} · Dispatched to IT Help Desk.`);
      setTimeout(() => setTicketToast(null), 6000);
    } catch {
      setErrorToast('Failed to create ticket. Please try again.');
      setTimeout(() => setErrorToast(null), 5000);
    } finally {
      setTicketLoading((prev) => {
        const next = new Set(prev);
        next.delete(msg.id);
        return next;
      });
    }
  }, [ticketLoading]);

  const handleMyTickets = useCallback(async () => {
    if (ticketsLoading) return;
    setTicketsLoading(true);
    try {
      const tickets = await getMyTickets();
      setMyTickets(tickets);
    } catch {
      // silently fail — keep existing state
    } finally {
      setTicketsLoading(false);
    }
  }, [ticketsLoading]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const openTicketCount = myTickets?.filter((t) => t.status === 'open').length ?? 0;

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Success Toast */}
      {ticketToast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-900 text-white px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 text-sm border border-gray-700 max-w-sm">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
          <span>{ticketToast}</span>
        </div>
      )}

      {/* Error Toast */}
      {errorToast && (
        <div className="fixed top-4 right-4 z-50 bg-red-900 text-white px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 text-sm border border-red-700 max-w-sm">
          <AlertTriangle className="w-5 h-5 text-red-300 flex-shrink-0" />
          <span>{errorToast}</span>
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
            <span className="text-[10px] text-brand-300 font-mono">Agentic RAG v2.0</span>
          </div>
        </div>
        <div className="p-3">
          <button
            onClick={() => { navigate('/chat'); setMessages([]); }}
            className="w-full flex items-center justify-center gap-2 text-sm bg-brand-700 hover:bg-brand-600 px-3 py-2.5 rounded-xl transition-all shadow-sm font-medium"
          >
            <Plus className="w-4 h-4" /> New Chat
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
          {/* My Tickets section */}
          <button
            onClick={handleMyTickets}
            disabled={ticketsLoading}
            className="w-full flex items-center gap-2 text-xs text-brand-200 hover:text-white px-3 py-2 rounded-lg hover:bg-brand-700 transition-colors disabled:opacity-60"
          >
            <span>🎫 My Tickets</span>
            {ticketsLoading ? (
              <span className="ml-auto text-[10px] text-brand-400">Loading...</span>
            ) : myTickets !== null ? (
              <span className={`ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                openTicketCount > 0 ? 'bg-red-500 text-white font-bold' : 'text-brand-400'
              }`}>
                ({openTicketCount} open)
              </span>
            ) : null}
          </button>

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

      {/* Main */}
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
                LangGraph v2 · Intent-Aware
              </span>
            </h1>
            <p className="text-xs text-gray-500">Agentic RAG · Intent Classification · Self-Correcting Retrieval · Web Fallback</p>
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

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-6 scrollbar-thin">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center max-w-xl mx-auto py-8">
              <div className="w-14 h-14 bg-brand-50 rounded-2xl flex items-center justify-center mb-4 text-brand-600 shadow-sm border border-brand-100">
                <LifeBuoy className="w-7 h-7" />
              </div>
              <h2 className="text-xl font-bold text-gray-800 mb-2">Welcome to Enterprise IT Copilot</h2>
              <p className="text-sm text-gray-500 mb-6 leading-relaxed">
                Ask anything — greetings, IT issues, HR policies, or technical questions. The agent intelligently routes your query to the right source.
              </p>
              <div className="grid gap-2.5 w-full text-left">
                {SAMPLE_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => handleSend(q)}
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
            <MessageBubble
              key={m.id}
              message={m}
              onEscalate={handleEscalate}
              ticketLoading={ticketLoading}
            />
          ))}

          {loading && (
            <div className="flex justify-start mb-4">
              <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm flex items-center gap-2.5 text-xs text-gray-500">
                <Loader2 className="w-4 h-4 text-brand-600 animate-spin" />
                <span>Classifying intent and routing query...</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="bg-white border-t border-gray-200 p-4">
          <div className="flex items-end gap-3 max-w-4xl mx-auto">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe your IT issue or ask a question... (Enter to send, Shift+Enter for newline)"
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
          <p className="text-center text-[10px] text-gray-400 mt-2">
            Powered by LangGraph · Groq · Pinecone · Tavily — All answers from verified sources only
          </p>
        </div>
      </div>
    </div>
  );
}
