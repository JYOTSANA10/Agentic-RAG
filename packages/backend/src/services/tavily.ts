interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

export async function searchWeb(
  query: string,
  maxResults = 4
): Promise<Array<{ title: string; url: string; content: string; score: number }>> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error('TAVILY_API_KEY is not set');

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'basic',
      max_results: maxResults,
      include_answer: false,
    }),
  });

  if (!response.ok) throw new Error(`Tavily search failed: ${response.statusText}`);

  const data = (await response.json()) as { results: TavilyResult[] };
  return data.results.map((r) => ({
    title: r.title,
    url: r.url,
    content: r.content,
    score: r.score,
  }));
}

