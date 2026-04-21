import type { FetchedArticle } from "./types";
import { cleanSnippet, cleanTitle } from "@/lib/text";

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
const TIMEOUT_MS = 8000;

function mapArticle(
  raw: NewsApiArticle,
  tagIds: string[],
  isHeadline: boolean,
): FetchedArticle | null {
  if (!raw.title || !raw.url || raw.title === "[Removed]") return null;
  return {
    title: cleanTitle(raw.title),
    url: raw.url,
    source: raw.source?.name ?? "Unknown",
    publishedAt: raw.publishedAt ? new Date(raw.publishedAt) : new Date(),
    snippet: cleanSnippet(raw.description),
    imageUrl: raw.urlToImage,
    tagIds,
    isHeadline,
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
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
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
  return raw.map((a) => mapArticle(a, [], true)).filter(nonNull);
}

export async function fetchTopHeadlinesSources(): Promise<FetchedArticle[]> {
  const raw = await callNewsApi("/top-headlines", {
    sources: "reuters,bbc-news,al-jazeera-english,bloomberg",
    pageSize: "50",
  });
  return raw.map((a) => mapArticle(a, [], true)).filter(nonNull);
}

export async function fetchEverythingForTag(
  tagId: string,
  queryTerms: string,
): Promise<FetchedArticle[]> {
  // Two passes: popularity (big-outlet coverage) + relevancy (tightly-matched
  // stories from smaller outlets). Union is deduped by URL downstream.
  const [popular, relevant] = await Promise.all([
    callNewsApi("/everything", {
      q: queryTerms,
      language: "en",
      sortBy: "popularity",
      pageSize: "60",
    }),
    callNewsApi("/everything", {
      q: queryTerms,
      language: "en",
      sortBy: "relevancy",
      pageSize: "60",
    }),
  ]);
  const seen = new Set<string>();
  const merged: NewsApiArticle[] = [];
  for (const a of [...popular, ...relevant]) {
    if (!a.url || seen.has(a.url)) continue;
    seen.add(a.url);
    merged.push(a);
  }
  return merged.map((a) => mapArticle(a, [tagId], false)).filter(nonNull);
}

// Ad-hoc keyword search. Same dual-sort pattern as tag fetches but tagless.
export async function fetchEverythingForKeywords(
  query: string,
): Promise<FetchedArticle[]> {
  const [popular, relevant] = await Promise.all([
    callNewsApi("/everything", {
      q: query,
      language: "en",
      sortBy: "popularity",
      pageSize: "60",
    }),
    callNewsApi("/everything", {
      q: query,
      language: "en",
      sortBy: "relevancy",
      pageSize: "60",
    }),
  ]);
  const seen = new Set<string>();
  const merged: NewsApiArticle[] = [];
  for (const a of [...popular, ...relevant]) {
    if (!a.url || seen.has(a.url)) continue;
    seen.add(a.url);
    merged.push(a);
  }
  return merged.map((a) => mapArticle(a, [], false)).filter(nonNull);
}

export async function fetchEverythingForDomains(
  domains: string,
): Promise<FetchedArticle[]> {
  const raw = await callNewsApi("/everything", {
    domains,
    language: "en",
    sortBy: "publishedAt",
    pageSize: "50",
  });
  return raw.map((a) => mapArticle(a, [], true)).filter(nonNull);
}

function nonNull<T>(v: T | null): v is T {
  return v !== null;
}
