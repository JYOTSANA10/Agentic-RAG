import { StateGraph, END } from '@langchain/langgraph';
import { createInitialState, type AgentState } from './state';
import {
  routerNode, retrieverNode, graderNode, rewriterNode,
  webSearchNode, webGraderNode, generatorNode, fallbackNode,
} from './nodes';

function afterGrade(state: AgentState): string {
  if (state.grade === 'sufficient') return 'generate';
  if (state.retriesLeft > 0) return 'rewrite';
  if (state.allowWebFallback) return 'web_search';
  return 'fallback';
}

function afterWebGrade(state: AgentState): string {
  return state.grade === 'sufficient' ? 'generate' : 'fallback';
}

export async function runWorkflow(question: string, allowWebFallback = true): Promise<AgentState> {
  const graph: any = new (StateGraph as any)({
    channels: {
      question:          { value: (_x: string,   y: string)   => y ?? _x, default: () => '' },
      rewrittenQuery:    { value: (_x: string,   y: string)   => y ?? _x, default: () => '' },
      documents:         { value: (_x: any,      y: any)      => y ?? [], default: () => [] },
      webResults:        { value: (_x: any,      y: any)      => y ?? [], default: () => [] },
      grade:             { value: (_x: any,      y: any)      => y ?? 'pending', default: () => 'pending' },
      sourceType:        { value: (_x: any,      y: any)      => y ?? 'none', default: () => 'none' },
      answer:            { value: (_x: string,   y: string)   => y ?? _x, default: () => '' },
      trace:             { value: (_x: any[],    y: any[])    => y ?? [], default: () => [] },
      retriesLeft:       { value: (_x: number,   y: number)   => y ?? _x, default: () => 1 },
      allowWebFallback:  { value: (_x: boolean,  y: boolean)  => y ?? _x, default: () => true },
    },
  });

  graph.addNode('router', routerNode);
  graph.addNode('retrieve', retrieverNode);
  graph.addNode('grade_docs', graderNode);
  graph.addNode('rewrite', rewriterNode);
  graph.addNode('web_search', webSearchNode);
  graph.addNode('web_grade', webGraderNode);
  graph.addNode('generate', generatorNode);
  graph.addNode('fallback', fallbackNode);

  graph.setEntryPoint('router');
  graph.addEdge('router', 'retrieve');
  graph.addEdge('retrieve', 'grade_docs');
  graph.addConditionalEdges('grade_docs', afterGrade, {
    generate: 'generate', rewrite: 'rewrite', web_search: 'web_search', fallback: 'fallback',
  });
  graph.addEdge('rewrite', 'retrieve');
  graph.addEdge('web_search', 'web_grade');
  graph.addConditionalEdges('web_grade', afterWebGrade, {
    generate: 'generate', fallback: 'fallback',
  });
  graph.addEdge('generate', END);
  graph.addEdge('fallback', END);

  const compiled = graph.compile();
  const result = await compiled.invoke(createInitialState(question, allowWebFallback));
  return result as AgentState;
}
