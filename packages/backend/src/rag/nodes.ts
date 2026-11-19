import { getChatModel } from '../services/openai';
import { retrieveChunks } from '../services/pinecone';
import { searchWeb } from '../services/tavily';
import type { AgentState, Citation, IntentType, TraceStep } from './state';

// qwen/qwen3.8-27b is a reasoning model — prefix every prompt with /nothink
// so it replies directly without outputting <think> blocks into content.
const NT = '/nothink\n';

/** Milliseconds since a timestamp */
function elapsed(start: number) { return Date.now() - start; }

function addTrace(
  state: AgentState,
  step: string,
  detail: string,
  status: TraceStep['status'] = 'done',
  startMs?: number,
): TraceStep[] {
  return [
    ...state.trace,
    {
      step,
      detail,
      status,
      durationMs: startMs !== undefined ? elapsed(startMs) : undefined,
      timestamp: Date.now(),
    },
  ];
}

// ── INTENT CLASSIFIER ─────────────────────────────────────────────────────────
// Lightweight keyword-first classifier; LLM is called only for ambiguous cases.
const GREETING_PATTERNS = /^(hi+|hello+|hey+|good\s*(morning|afternoon|evening|night)|howdy|sup|greetings|hiya|yo)\b/i;
const FAREWELL_PATTERNS = /^(bye+|goodbye+|see\s*you|take\s*care|farewell|thanks+\s*(bye)?|thank\s*you\s*(bye)?|cheers)\b/i;
const CHITCHAT_PATTERNS = /^(how\s*are\s*you|what('s|\s+is)\s*up|how\s*do\s*you\s*do|what\s*can\s*you\s*do|tell\s*me\s*a\s*joke|what\s+are\s+you|who\s+are\s+you)/i;

export async function intentClassifierNode(state: AgentState): Promise<Partial<AgentState>> {
  const start = Date.now();
  const q = state.question.trim();

  // Fast-path: purely keyword-based for common cases (no LLM cost)
  if (GREETING_PATTERNS.test(q) || FAREWELL_PATTERNS.test(q)) {
    return {
      intent: 'greeting',
      trace: addTrace(state, 'Intent Classifier', 'Intent: Greeting (keyword match)', 'done', start),
    };
  }
  if (CHITCHAT_PATTERNS.test(q)) {
    return {
      intent: 'general_conversation',
      trace: addTrace(state, 'Intent Classifier', 'Intent: General Conversation (keyword match)', 'done', start),
    };
  }

  // LLM-based classification for everything else
  const model = getChatModel(0);
  const response = await model.invoke(
    `${NT}You are an intent classifier for an Enterprise IT Support Copilot chatbot.

Classify the user message into exactly one of these categories:
- greeting: Greetings, farewells, social pleasantries (hi, hello, good morning, thank you, bye)
- general_conversation: Casual or general chat not related to IT or company specifics (jokes, what can you do, tell me about yourself)
- it_support: IT hardware/software issues, VPN, MFA, device problems, access requests, system outages
- company_policy: HR policies, leave, benefits, onboarding, offboarding, expense rules, company procedures
- technical_troubleshooting: Technical debugging, DNS, networking, Windows/Mac troubleshooting steps
- external_information: Real-time service status, vendor updates, latest software versions, news
- unknown: Ambiguous or unclear queries requiring clarification

User message: "${q}"

Respond with ONLY the category name, nothing else.`
  );

  const raw = response.content.toString().trim().toLowerCase().replace(/[^a-z_]/g, '');
  const validIntents: IntentType[] = [
    'greeting', 'general_conversation', 'it_support', 'company_policy',
    'technical_troubleshooting', 'external_information', 'unknown',
  ];
  const intent: IntentType = validIntents.includes(raw as IntentType)
    ? (raw as IntentType)
    : 'unknown';

  return {
    intent,
    trace: addTrace(state, 'Intent Classifier', `Intent: ${intent}`, 'done', start),
  };
}

// ── DIRECT RESPONSE (Greeting / General Chat) ────────────────────────────────
export async function directResponseNode(state: AgentState): Promise<Partial<AgentState>> {
  const start = Date.now();
  const model = getChatModel(0.7);

  let systemContext = '';
  if (state.intent === 'greeting') {
    systemContext = `You are a friendly Enterprise IT Support Copilot. Respond warmly and briefly to greetings.
Let the user know you can help with IT issues, company policies, HR queries, and technical troubleshooting.
Keep it concise (2-3 sentences max). Do NOT mention any documents or knowledge base.`;
  } else if (state.intent === 'unknown') {
    systemContext = `You are a friendly Enterprise IT Support Copilot. The user's intent is unclear.
Politely ask for clarification, and suggest what you can help with:
- IT hardware/software issues
- Company HR policies and procedures
- Technical troubleshooting
- Real-time service status checks
Keep it concise and friendly.`;
  } else {
    systemContext = `You are a helpful Enterprise IT Support Copilot. Answer this general question conversationally.
You specialize in IT support, company policies, and technical troubleshooting.
If asked what you can do, mention your capabilities clearly.`;
  }

  const response = await model.invoke(
    `${NT}${systemContext}\n\nUser: ${state.question}\n\nAssistant:`
  );

  return {
    answer: response.content.toString().trim(),
    sourceType: 'none',
    documents: [],
    webResults: [],
    trace: addTrace(state, 'Direct Response', `Responded to ${state.intent} intent`, 'done', start),
  };
}

// ── ROUTER ────────────────────────────────────────────────────────────────────
// Decides whether to retrieve from internal KB or go straight to web search.
export async function routerNode(state: AgentState): Promise<Partial<AgentState>> {
  const start = Date.now();
  // For external_information intent, skip internal retrieval
  if (state.intent === 'external_information') {
    return {
      trace: addTrace(state, 'Router', 'External information → routing to web search', 'done', start),
    };
  }
  return {
    trace: addTrace(state, 'Router', 'Internal/IT query → routing to knowledge base retrieval', 'done', start),
  };
}

// ── RETRIEVER ─────────────────────────────────────────────────────────────────
export async function retrieverNode(state: AgentState): Promise<Partial<AgentState>> {
  const start = Date.now();
  const query = state.rewrittenQuery || state.question;

  let chunks: Array<{ id: string; text: string; source: string; score: number }> = [];
  try {
    chunks = await retrieveChunks(query, 5);
  } catch (err) {
    return {
      documents: [],
      grade: 'insufficient',
      trace: addTrace(state, 'Retriever', `Pinecone error: ${(err as Error).message}`, 'error', start),
    };
  }

  // Deduplicate by chunk id
  const seen = new Set<string>();
  const documents: Citation[] = [];
  for (const c of chunks) {
    if (!seen.has(c.id)) {
      seen.add(c.id);
      documents.push({ id: c.id, source: c.source, excerpt: c.text, score: c.score });
    }
  }

  return {
    documents,
    trace: addTrace(state, 'Retriever', `Retrieved ${documents.length} unique chunks for: "${query}"`, 'done', start),
  };
}

// ── GRADER ────────────────────────────────────────────────────────────────────
export async function graderNode(state: AgentState): Promise<Partial<AgentState>> {
  const start = Date.now();
  if (state.documents.length === 0) {
    return {
      grade: 'insufficient',
      trace: addTrace(state, 'Evidence Grader', 'No documents retrieved — insufficient', 'done', start),
    };
  }

  // Filter out very low-score chunks (cosine similarity < 0.3)
  const relevant = state.documents.filter((d) => (d.score ?? 1) >= 0.3);
  if (relevant.length === 0) {
    return {
      grade: 'insufficient',
      documents: state.documents,
      trace: addTrace(state, 'Evidence Grader', `All ${state.documents.length} chunks below relevance threshold (0.3)`, 'done', start),
    };
  }

  const model = getChatModel(0);
  const context = relevant
    .map((d, i) => `[Document ${i + 1} — ${d.source} (score: ${d.score?.toFixed(3)})]:\n${d.excerpt}`)
    .join('\n\n');

  const response = await model.invoke(
    `${NT}You are an evidence quality evaluator for an enterprise knowledge base system.

Does the provided context contain specific, factual information that meaningfully answers the user's question?
Answer YES only if the context directly addresses the question with relevant facts, policies, or instructions.
Answer NO if the context is off-topic, too generic, or insufficient.

Question: ${state.question}

Context:
${context}

Respond with ONLY "YES" or "NO".`
  );

  const text = response.content.toString().trim().toUpperCase();
  const grade: 'sufficient' | 'insufficient' = text.startsWith('YES') || text.includes('YES') ? 'sufficient' : 'insufficient';

  return {
    grade,
    sourceType: grade === 'sufficient' ? 'internal' : state.sourceType,
    trace: addTrace(
      state, 'Evidence Grader',
      `Grade: ${grade} (${relevant.length}/${state.documents.length} chunks above threshold)`,
      'done', start
    ),
  };
}

// ── QUERY REWRITER ────────────────────────────────────────────────────────────
export async function rewriterNode(state: AgentState): Promise<Partial<AgentState>> {
  const start = Date.now();
  const model = getChatModel(0);
  const response = await model.invoke(
    `${NT}You are helping search an internal company knowledge base. Rephrase the user's query into clear search keywords.

Rules:
- Preserve the core intent
- Use specific terms (e.g. "sick leave carry forward policy", "offboarding company files", "MFA setup procedure")
- Do NOT add jargon unrelated to the topic
- Do NOT make the query longer than 15 words
- Return ONLY the rephrased query string, nothing else

Original query: ${state.question}
Rephrased:`
  );

  const rewrittenQuery = response.content.toString().trim().replace(/^["']|["']$/g, '');
  return {
    rewrittenQuery,
    retriesLeft: state.retriesLeft - 1,
    rewriteCount: (state.rewriteCount ?? 0) + 1,
    trace: addTrace(state, 'Query Rewriter', `Rewritten: "${rewrittenQuery}"`, 'done', start),
  };
}

// ── WEB SEARCH ────────────────────────────────────────────────────────────────
export async function webSearchNode(state: AgentState): Promise<Partial<AgentState>> {
  const start = Date.now();

  let results: Array<{ title: string; content: string; url: string; score: number }> = [];
  try {
    results = await searchWeb(state.rewrittenQuery || state.question, 4);
  } catch (err) {
    return {
      webResults: [],
      trace: addTrace(state, 'Web Search', `Tavily error: ${(err as Error).message}`, 'error', start),
    };
  }

  const webResults: Citation[] = results.map((r) => ({
    source: r.title,
    excerpt: r.content,
    score: r.score,
    url: r.url,
  }));

  return {
    webResults,
    trace: addTrace(state, 'Web Search', `Found ${webResults.length} web results`, 'done', start),
  };
}

// ── WEB GRADER ───────────────────────────────────────────────────────────────
export async function webGraderNode(state: AgentState): Promise<Partial<AgentState>> {
  const start = Date.now();
  if (state.webResults.length === 0) {
    return {
      grade: 'insufficient',
      sourceType: 'none',
      trace: addTrace(state, 'Web Evidence Grader', 'No web results to evaluate', 'done', start),
    };
  }

  const model = getChatModel(0);
  const context = state.webResults
    .map((r, i) => `[Source ${i + 1}: ${r.source}]\n${r.excerpt}`)
    .join('\n\n');

  const response = await model.invoke(
    `${NT}Does the following web search context contain useful, relevant information to answer the question?
Respond ONLY with YES or NO.

Question: ${state.question}

Web Context:
${context}`
  );

  const text = response.content.toString().trim().toUpperCase();
  const grade: 'sufficient' | 'insufficient' = text.startsWith('YES') || text.includes('YES') ? 'sufficient' : 'insufficient';

  return {
    grade,
    sourceType: grade === 'sufficient' ? 'web' : 'none',
    trace: addTrace(state, 'Web Evidence Grader', `Web grade: ${grade} (${state.webResults.length} sources)`, 'done', start),
  };
}

// ── GENERATOR ─────────────────────────────────────────────────────────────────
export async function generatorNode(state: AgentState): Promise<Partial<AgentState>> {
  const start = Date.now();
  const model = getChatModel(0.2);
  const isWeb = state.sourceType === 'web';
  const citations = isWeb ? state.webResults : state.documents;

  // Deduplicate citations by source for the prompt
  const uniqueSources = new Map<string, Citation>();
  for (const c of citations) {
    const key = c.id || `${c.source}::${c.excerpt.slice(0, 50)}`;
    if (!uniqueSources.has(key)) uniqueSources.set(key, c);
  }
  const dedupedCitations = Array.from(uniqueSources.values());
  const context = dedupedCitations
    .map((c, i) => `[Source ${i + 1}: ${c.source}]\n${c.excerpt}`)
    .join('\n\n');

  const response = await model.invoke(
    `${NT}You are an Enterprise IT Support Copilot. Answer the employee's question using ONLY the provided ${isWeb ? 'web search results' : 'company knowledge base documents'}.

STRICT RULES:
- Base your answer ONLY on the provided context. Do NOT invent policies, names, figures, or procedures.
- If a specific detail (salary, password, office address, etc.) is not in the context, explicitly say it is not available in the knowledge base.
- Structure your response clearly using markdown: use **bold** for key terms, bullet lists for steps.
- If the context is from internal documents, do not add disclaimers about verifying with web sources.
${isWeb ? '- Note at the end that this answer uses external web sources and should be verified with internal IT.\n' : ''}
After your answer, on a NEW LINE, write exactly:
SOURCES_USED: <comma-separated list of source numbers you actually used, e.g. 1,3>
If you used no sources, write: SOURCES_USED: none

Question: ${state.question}

Context:
${context}

Answer:`
  );

  const rawContent = response.content.toString().trim();
  let answer = rawContent;
  let finalCitations = dedupedCitations;

  const match = rawContent.match(/SOURCES_USED:\s*([^\n\r]+)/i);
  if (match) {
    // Strip the SOURCES_USED line from the displayed answer
    answer = rawContent.replace(/\n?SOURCES_USED:\s*[^\n\r]+/gi, '').trim();
    const sourceStr = match[1].trim().toLowerCase();
    if (sourceStr === 'none' || sourceStr === '') {
      finalCitations = [];
    } else {
      const indices = (sourceStr.match(/\d+/g) || [])
        .map(Number)
        .map((n) => n - 1)
        .filter((idx) => idx >= 0 && idx < dedupedCitations.length);
      const uniqueIndices = Array.from(new Set(indices));
      finalCitations = uniqueIndices.map((idx) => dedupedCitations[idx]);
    }
  }

  return {
    answer,
    documents: isWeb ? state.documents : finalCitations,
    webResults: isWeb ? finalCitations : state.webResults,
    sourceType: state.sourceType === 'none' ? 'internal' : state.sourceType,
    trace: addTrace(
      state,
      'Generator',
      `Answer generated from ${isWeb ? 'web' : 'internal'} sources (${finalCitations.length} cited of ${dedupedCitations.length} unique sources)`,
      'done',
      start
    ),
  };
}

// ── ESCALATION CHECK ─────────────────────────────────────────────────────────
export async function escalationNode(state: AgentState): Promise<Partial<AgentState>> {
  const start = Date.now();
  const model = getChatModel(0);

  const response = await model.invoke(
    `${NT}You are an IT support escalation classifier. Analyze this IT issue and determine:
1. Should this be escalated to a human IT support agent? (YES/NO)
2. If YES, what priority level? Choose ONE: P1 (Critical/whole org affected), P2 (Major/multiple users affected), P3 (Standard/single user affected), P4 (Low/cosmetic issue)

Format your response as: ESCALATE:YES|PRIORITY:P2  OR  ESCALATE:NO

Issue: ${state.question}`
  );

  const text = response.content.toString().trim();
  const shouldEscalate = text.includes('ESCALATE:YES');
  let priority: AgentState['escalationPriority'] = null;

  if (shouldEscalate) {
    const priMatch = text.match(/PRIORITY:(P[1-4])/);
    priority = priMatch ? (priMatch[1] as AgentState['escalationPriority']) : 'P3';
  }

  return {
    needsEscalation: shouldEscalate,
    escalationPriority: priority,
    trace: addTrace(
      state, 'Escalation Check',
      shouldEscalate ? `Escalation needed: ${priority}` : 'No escalation required',
      'done', start
    ),
  };
}

// ── FALLBACK ──────────────────────────────────────────────────────────────────
export async function fallbackNode(state: AgentState): Promise<Partial<AgentState>> {
  const start = Date.now();
  const webSearched = state.webResults.length > 0;
  const isITSupport = state.intent === 'it_support';
  const isTechTroubleshoot = state.intent === 'technical_troubleshooting';
  const isCompanyPolicy = state.intent === 'company_policy';
  const shouldEscalate = isITSupport || isTechTroubleshoot;

  let answer = '';
  if (isCompanyPolicy) {
    answer = `I wasn't able to find the relevant company policy for: **"${state.question}"** in the knowledge base.

${webSearched ? 'I checked both internal policy documents and company resources, but could not find matching documentation.' : 'I searched our internal policy documents, but could not locate official guidelines on this topic.'}

**Recommended next steps:**
- 📋 Check the official **Employee Handbook** or company intranet
- 🏢 Contact the **People Operations / HR team** directly
- 💬 Reach out to your manager or People Partner for policy clarification`;
  } else if (isITSupport) {
    answer = `I couldn't find a solution in the IT knowledge base for your issue: **"${state.question}"**.

${webSearched ? 'I searched internal IT articles and external support resources, but could not resolve this.' : 'I searched our internal IT support articles, but could not find matching troubleshooting steps.'}

**What you can do:**
- 🎫 **Submit an IT support ticket** using the escalation button below (Priority: P3)
- 📧 Email **IT Help Desk** directly for assistance
- 📞 For urgent workstation or system outages, contact the IT emergency line`;
  } else if (isTechTroubleshoot) {
    answer = `I was unable to find technical troubleshooting instructions for: **"${state.question}"**.

${webSearched ? 'I checked our technical knowledge base and public technical documentation without finding a verified solution.' : 'I searched our internal runbooks and technical guides, but found no matching procedure.'}

**Recommended next steps:**
- 🎫 **Escalate to Engineering / IT Support** via the ticket option below (Priority: P3)
- 🔍 Check internal engineering runbooks and system status dashboards
- 💬 Ask in the relevant technical support channel`;
  } else {
    answer = `I wasn't able to find sufficient information to answer: **"${state.question}"**

${webSearched ? 'I searched both the internal knowledge base and public web sources, but ' : 'I searched the internal knowledge base but '} couldn't find matching policies or instructions.

**What you can do:**
- 📧 Contact **IT Help Desk** directly for technical issues
- 📋 Check the **employee portal** for the latest policy updates
- 🏢 Reach out to **People Operations** for HR policy questions
- 🎫 Submit a **support ticket** using the escalation button below

*Note: If this is an urgent issue, please call the IT support hotline directly.*`;
  }

  return {
    answer,
    sourceType: 'none',
    needsEscalation: shouldEscalate ? true : state.needsEscalation,
    escalationPriority: shouldEscalate ? (state.escalationPriority || 'P3') : state.escalationPriority,
    trace: addTrace(
      state,
      'Fallback',
      shouldEscalate
        ? `Fallback response generated for ${state.intent} (escalation: P3)`
        : `Fallback response generated for ${state.intent}`,
      'done',
      start
    ),
  };
}
