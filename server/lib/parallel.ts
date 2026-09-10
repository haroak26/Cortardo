const PARALLEL_API_KEY = process.env.PARALLEL_API_KEY;
const PARALLEL_BASE_URL = "https://api.parallel.ai/v1";

export interface ExtractedPage {
  url: string;
  title: string;
  content: string;
}

export interface ExtractError {
  url: string;
  errorType: string;
  httpStatusCode: number | null;
  content: string;
}

export interface SearchResult {
  url: string;
  title: string;
  excerpt: string;
}

interface ExtractResult {
  url: string;
  title: string | null;
  excerpts: string[];
  full_content: string | null;
}

interface ExtractResponse {
  extract_id: string;
  results: ExtractResult[];
  errors: ExtractError[];
  session_id: string;
}

interface SearchResponse {
  results: SearchResult[];
  session_id: string;
}

function assertKey(): string {
  if (!PARALLEL_API_KEY) throw new Error("PARALLEL_API_KEY not configured");
  return PARALLEL_API_KEY;
}

export async function searchDomainPages(domain: string): Promise<SearchResult[]> {
  const apiKey = assertKey();
  try {
    const res = await fetch(`${PARALLEL_BASE_URL}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        objective: `Find all documentation and content pages on ${domain}`,
        site: domain,
        max_results: 50,
      }),
    });
    if (!res.ok) return [];
    const data: SearchResponse = await res.json();
    return data.results ?? [];
  } catch {
    return [];
  }
}

export async function extractPages(urls: string[]): Promise<{ pages: ExtractedPage[]; errors: ExtractError[] }> {
  const apiKey = assertKey();
  const allPages: ExtractedPage[] = [];
  const allErrors: ExtractError[] = [];

  const batchSize = 20;
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);

    const res = await fetch(`${PARALLEL_BASE_URL}/extract`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        urls: batch,
        client_model: "openai/gpt-oss-120b",
        advanced_settings: {
          full_content: true,
        },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`Parallel Extract API error ${res.status}: ${errBody}`);
    }

    const data: ExtractResponse = await res.json();

    for (const result of data.results) {
      const content = result.full_content || result.excerpts.join("\n\n");
      if (content) {
        allPages.push({
          url: result.url,
          title: result.title || new URL(result.url).hostname,
          content,
        });
      }
    }

    for (const err of data.errors) {
      allErrors.push(err);
    }
  }

  return { pages: allPages, errors: allErrors };
}
