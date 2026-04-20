import type { FetchedArticle } from "./types";

type NewsApiArticle = {
  title: string | null;
  url: string | null;
  source: { name: string | null } | null;
  publishedAt: string | null;
  description: string | null;
  urlToImage: string | null;
};

type NewsApiResponse = {
  status: string;
  articles?: NewsApiArticle[];
  message?: string;
};

const BASE = "https://newsapi.org/v2";

function mapArticle(
  raw: NewsApiArticle,
  tagIds: string[],
): FetchedArticle | null {
  if (!raw.title || !raw.url || raw.title === "[Removed]") return null;
  return {
    title: raw.title,
    url: raw.url,
    source: raw.source?.name ?? "Unknown",
    publishedAt: raw.publishedAt ? new Date(raw.publishedAt) : new Date(),
    snippet: raw.description,
    imageUrl: raw.urlToImage,
    tagIds,
  };
}

async function callNewsApi(
  path: string,
  params: Record<string, string>,
): Promise<NewsApiArticle[]> {
  const apiKey = process.env.NEWSAPI_KEY;
  if (!apiKey) {
    console.warn("NEWSAPI_KEY missing; skipping NewsAPI call");
    return [];
  }

  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  try {
    const res = await fetch(url.toString(), {
      headers: { "X-Api-Key": apiKey },
    });
    const data = (await res.json()) as NewsApiResponse;
    if (data.status !== "ok") {
      console.warn(`NewsAPI ${path} returned ${data.status}: ${data.message}`);
      return [];
    }
    return data.articles ?? [];
  } catch (err) {
    console.error(`NewsAPI ${path} failed:`, err);
    return [];
  }
}

export async function fetchTopHeadlinesGeneral(): Promise<FetchedArticle[]> {
  const raw = await callNewsApi("/top-headlines", {
    category: "general",
    language: "en",
    pageSize: "50",
  });
  return raw.map((a) => mapArticle(a, [])).filter(nonNull);
}

export async function fetchTopHeadlinesSources(): Promise<FetchedArticle[]> {
  const raw = await callNewsApi("/top-headlines", {
    sources: "reuters,bbc-news,al-jazeera-english,bloomberg",
    pageSize: "50",
  });
  return raw.map((a) => mapArticle(a, [])).filter(nonNull);
}

export async function fetchEverythingForTag(
  tagId: string,
  queryTerms: string,
): Promise<FetchedArticle[]> {
  const raw = await callNewsApi("/everything", {
    q: queryTerms,
    language: "en",
    sortBy: "publishedAt",
    pageSize: "30",
  });
  return raw.map((a) => mapArticle(a, [tagId])).filter(nonNull);
}

function nonNull<T>(v: T | null): v is T {
  return v !== null;
}
