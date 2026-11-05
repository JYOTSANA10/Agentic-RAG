import { getChatModel } from '../services/openai';
import { retrieveChunks } from '../services/pinecone';
import { searchWeb } from '../services/tavily';
import type { AgentState, Citation, TraceStep } from './state';

// qwen/qwen3.8-27b is a reasoning model — prefix every prompt with /nothink
// so it replies directly without outputting <think> blocks into content.
const NT = '/nothink\n';

function addTrace(state: AgentState, step: string, detail: string): TraceStep[] {
  return [...state.trace, { step, detail, timestamp: Date.now() }];
}

// ── ROUTER ────────────────────────────────────────────────────────────────────
export async function routerNode(state: AgentState): Promise<Partial<AgentState>> {
  const model = getChatModel(0);
  const response = await model.invoke(
    `${NT}You are a company workplace and IT support router. Decide if this question is asking about internal company topics (e.g. HR policies, leave allowance, benefits, onboarding, VPN, IT setup, devices, software access) or general knowledge.
Respond ONLY with "internal" or "direct".
Question: ${state.question}`
  );
  const decision = response.content.toString().trim().toLowerCase();
  return {
    trace: addTrace(state, 'Router', `Decision: ${decision.includes('internal') ? 'internal retrieval needed' : 'can answer directly'}`),
  };
}

// ── RETRIEVER ─────────────────────────────────────────────────────────────────
export async function retrieverNode(state: AgentState): Promise<Partial<AgentState>> {
  const query = state.rewrittenQuery || state.question;
  const chunks = await retrieveChunks(query, 5);
  // Pass full chunk text — never slice — so grader and generator see complete policy data
  const documents: Citation[] = chunks.map((c) => ({
    source: c.source,
    excerpt: c.text,
    score: c.score,
  }));
  return {
    documents,
    trace: addTrace(state, 'Retriever', `Found ${documents.length} chunks for: "${query}"`),
  };
}

// ── GRADER ────────────────────────────────────────────────────────────────────
export async function graderNode(state: AgentState): Promise<Partial<AgentState>> {
  if (state.documents.length === 0) {
    return {
      grade: 'insufficient',
      trace: addTrace(state, 'Grader', 'No documents retrieved — insufficient'),
    };
  }
  const model = getChatModel(0);
  const context = state.documents.map((d, i) => `[Document ${i + 1} (${d.source})]\n${d.excerpt}`).join('\n\n');
  const response = await model.invoke(
    `${NT}You are an evaluation assistant. Does the provided reference context contain facts, policies, or instructions that can help answer the user question?
Question: ${state.question}

Reference Context:
${context}

If the context contains relevant information to address the question in whole or in part, respond with "YES". Otherwise respond with "NO". Respond ONLY with YES or NO.`
  );
  const text = response.content.toString().trim().toUpperCase();
  const grade: 'sufficient' | 'insufficient' = text.startsWith('YES') || text.includes('YES') ? 'sufficient' : 'insufficient';
  return {
    grade,
    sourceType: grade === 'sufficient' ? 'internal' : state.sourceType,
    trace: addTrace(state, 'Grader', `Evidence grade: ${grade} (${state.documents.length} docs)`),
  };
}

// ── QUERY REWRITER ────────────────────────────────────────────────────────────
export async function rewriterNode(state: AgentState): Promise<Partial<AgentState>> {
  const model = getChatModel(0);
  const response = await model.invoke(
    `${NT}You are helping search an internal company handbook. Rephrase the query into natural keywords and common terms used in company policy documents.
Keep it simple and direct. Do NOT add unnecessary IT jargon if the topic is HR, leave, or company policy.
Return ONLY the rephrased query string.

Original: ${state.question}
Rephrased:`
  );
  const rewrittenQuery = response.content.toString().trim().replace(/^[\"']|[\"']$/g, '');
  return {
    rewrittenQuery,
    retriesLeft: state.retriesLeft - 1,
    trace: addTrace(state, 'Query Rewriter', `Rewritten: "${rewrittenQuery}"`),
  };
}

// ── WEB SEARCH ────────────────────────────────────────────────────────────────
export async function webSearchNode(state: AgentState): Promise<Partial<AgentState>> {
  const results = await searchWeb(state.rewrittenQuery || state.question, 4);
  const webResults: Citation[] = results.map((r) => ({
    source: r.title,
    excerpt: r.content,
    score: r.score,
    url: r.url,
  }));
  return {
    webResults,
    trace: addTrace(state, 'Web Search', `Found ${webResults.length} web results`),
  };
}

// ── WEB GRADER ───────────────────────────────────────────────────────────────
export async function webGraderNode(state: AgentState): Promise<Partial<AgentState>> {
  if (state.webResults.length === 0) {
    return {
      grade: 'insufficient',
      sourceType: 'none',
      trace: addTrace(state, 'Web Grader', 'No web results found'),
    };
  }
  const model = getChatModel(0);
  const context = state.webResults.map((r, i) => `[Source ${i + 1}: ${r.source}]\n${r.excerpt}`).join('\n\n');
  const response = await model.invoke(
    `${NT}Does the following web context contain information relevant to answering the question?
Question: ${state.question}

Web Context:
${context}

Respond ONLY with YES or NO.`
  );
  const text = response.content.toString().trim().toUpperCase();
  const grade: 'sufficient' | 'insufficient' = text.startsWith('YES') || text.includes('YES') ? 'sufficient' : 'insufficient';
  return {
    grade,
    sourceType: grade === 'sufficient' ? 'web' : 'none',
    trace: addTrace(state, 'Web Grader', `Web evidence grade: ${grade}`),
  };
}

// ── GENERATOR ─────────────────────────────────────────────────────────────────
export async function generatorNode(state: AgentState): Promise<Partial<AgentState>> {
  const model = getChatModel(0.2);
  const isWeb = state.sourceType === 'web';
  const citations = isWeb ? state.webResults : state.documents;
  const context = citations.map((c, i) => `[Source ${i + 1}: ${c.source}]\n${c.excerpt}`).join('\n\n');

  const response = await model.invoke(
    `${NT}You are an enterprise workplace and IT support assistant. Answer the employee's question accurately using ONLY the provided ${isWeb ? 'web search results' : 'company documents'}.

Guidelines:
- Provide a clear, comprehensive, and well-structured answer.
- Highlight specific numbers, policies, deadlines, and step-by-step instructions.
- If information is explicitly stated in the context, quote or summarize it directly.
${isWeb ? '- Note that this answer is synthesized from external web sources and should be verified with internal teams.' : ''}

Question: ${state.question}

Context:
${context}

Answer:`
  );

  return {
    answer: response.content.toString().trim(),
    sourceType: state.sourceType === 'none' ? 'internal' : state.sourceType,
    trace: addTrace(state, 'Generator', `Answer generated from ${isWeb ? 'web sources' : 'internal docs'}`),
  };
}

// ── FALLBACK ──────────────────────────────────────────────────────────────────
export async function fallbackNode(state: AgentState): Promise<Partial<AgentState>> {
  return {
    answer: `I wasn't able to find sufficient information to answer: **"${state.question}"**\n\nI searched the internal knowledge base${state.allowWebFallback ? ' and the web' : ''} but couldn't find matching policies or instructions. Please:\n- Contact the Help Desk / People Operations directly\n- Check the employee portal for the latest policy updates\n- Submit a support ticket for assistance`,
    sourceType: 'none',
    trace: addTrace(state, 'Fallback', 'Insufficient evidence from all sources'),
  };
}
