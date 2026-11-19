import { StateGraph, END } from '@langchain/langgraph';
import { createInitialState, type AgentState } from './state';
import {
  intentClassifierNode,
  directResponseNode,
  routerNode,
  retrieverNode,
  graderNode,
  rewriterNode,
  webSearchNode,
  webGraderNode,
  generatorNode,
  escalationNode,
  fallbackNode,
} from './nodes';

// ── Routing functions ─────────────────────────────────────────────────────────

/** After intent classification: direct response or retrieval path */
export function afterIntent(state: AgentState): string {
  const { intent } = state;
  if (intent === 'greeting' || intent === 'general_conversation' || intent === 'unknown') {
    return 'direct_response';
  }
  if (intent === 'external_information') {
    return 'web_search';
  }
  // it_support, company_policy, technical_troubleshooting → router → retrieve
  return 'router';
}

/** After grading internal docs */
export function afterGrade(state: AgentState): string {
  if (state.grade === 'sufficient') return 'generate';
  if (state.retriesLeft > 0) return 'rewrite';
  if (state.retriesLeft <= 0 && (state.rewriteCount ?? 0) >= 2) return 'fallback';
  if (state.intent === 'company_policy') return 'fallback';
  if (state.allowWebFallback) return 'web_search';
  return 'fallback';
}

/** After grading web results */
export function afterWebGrade(state: AgentState): string {
  return state.grade === 'sufficient' ? 'generate' : 'fallback';
}

/** After generating an answer: check if escalation needed for IT issues.
 *  Task 1 fix: use evidence absence (no docs AND no webResults) rather than
 *  sourceType === 'none', because generatorNode always upgrades sourceType to
 *  'internal' even when no good evidence was found. */
export function afterGenerate(state: AgentState): string {
  const hasNoEvidence = state.documents.length === 0 && state.webResults.length === 0;
  if (
    hasNoEvidence &&
    (state.intent === 'it_support' || state.intent === 'technical_troubleshooting')
  ) {
    return 'escalation_check';
  }
  return 'done';
}

// ── Build + compile the graph ─────────────────────────────────────────────────

export async function runWorkflow(question: string, allowWebFallback = true): Promise<AgentState> {
  const graph: any = new (StateGraph as any)({
    channels: {
      question:            { value: (_x: string,  y: string)  => y ?? _x, default: () => '' },
      intent:              { value: (_x: any,     y: any)     => y ?? _x, default: () => 'unknown' },
      rewrittenQuery:      { value: (_x: string,  y: string)  => y ?? _x, default: () => '' },
      documents:           { value: (_x: any,     y: any)     => y ?? [], default: () => [] },
      webResults:          { value: (_x: any,     y: any)     => y ?? [], default: () => [] },
      grade:               { value: (_x: any,     y: any)     => y ?? 'pending', default: () => 'pending' },
      sourceType:          { value: (_x: any,     y: any)     => y ?? 'none', default: () => 'none' },
      answer:              { value: (_x: string,  y: string)  => y ?? _x, default: () => '' },
      trace:               { value: (_x: any[],   y: any[])   => y ?? [], default: () => [] },
      retriesLeft:         { value: (_x: number,  y: number)  => y ?? _x, default: () => 1 },
      allowWebFallback:    { value: (_x: boolean, y: boolean) => y ?? _x, default: () => true },
      needsEscalation:     { value: (_x: boolean, y: boolean) => y ?? _x, default: () => false },
      escalationPriority:  { value: (_x: any,     y: any)     => y ?? _x, default: () => null },
      rewriteCount:        { value: (_x: number,  y: number)  => y ?? _x, default: () => 0 },
    },
  });

  // Register nodes
  graph.addNode('classify_intent', intentClassifierNode);
  graph.addNode('direct_response', directResponseNode);
  graph.addNode('router', routerNode);
  graph.addNode('retrieve', retrieverNode);
  graph.addNode('grade_docs', graderNode);
  graph.addNode('rewrite', rewriterNode);
  graph.addNode('web_search', webSearchNode);
  graph.addNode('web_grade', webGraderNode);
  graph.addNode('generate', generatorNode);
  graph.addNode('escalation_check', escalationNode);
  graph.addNode('fallback', fallbackNode);

  // Entry point
  graph.setEntryPoint('classify_intent');

  // Intent → route decision
  graph.addConditionalEdges('classify_intent', afterIntent, {
    direct_response: 'direct_response',
    router: 'router',
    web_search: 'web_search',
  });

  // Direct response → END (no retrieval for greetings/chitchat)
  graph.addEdge('direct_response', END);

  // Internal retrieval path
  graph.addEdge('router', 'retrieve');
  graph.addEdge('retrieve', 'grade_docs');
  graph.addConditionalEdges('grade_docs', afterGrade, {
    generate: 'generate',
    rewrite: 'rewrite',
    web_search: 'web_search',
    fallback: 'fallback',
  });
  graph.addEdge('rewrite', 'retrieve');

  // Web search path
  graph.addEdge('web_search', 'web_grade');
  graph.addConditionalEdges('web_grade', afterWebGrade, {
    generate: 'generate',
    fallback: 'fallback',
  });

  // Generator → optional escalation check, then done
  graph.addConditionalEdges('generate', afterGenerate, {
    escalation_check: 'escalation_check',
    done: 'done_node',
  });
  graph.addNode('done_node', async (state: AgentState) => state); // passthrough to END
  graph.addEdge('done_node', END);
  graph.addEdge('escalation_check', END);

  graph.addEdge('fallback', END);

  const compiled = graph.compile();
  const result = await compiled.invoke(createInitialState(question, allowWebFallback));
  return result as AgentState;
}
