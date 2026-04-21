import Parser from "rss-parser";
import type { FetchedArticle } from "./types";
import { cleanSnippet, cleanTitle } from "@/lib/text";

const parser = new Parser({
  timeout: 10000,
  customFields: {
    item: [
      ["media:content", "mediaContent", { keepArray: true }],
      ["media:thumbnail", "mediaThumbnail", { keepArray: true }],
      ["media:group", "mediaGroup"],
      ["content:encoded", "contentEncoded"],
    ],
  },
});

const MAX_AGE_DAYS = 14;

const PLACEHOLDER_TITLE_PATTERNS = [
  /^here[’']?s the latest\.?$/i,
  /^live updates?\.?$/i,
  /^the latest\.?$/i,
  /^what to know\.?$/i,
];

function isPlaceholderTitle(title: string): boolean {
  const trimmed = title.trim();
  if (trimmed.length < 10) return true;
  return PLACEHOLDER_TITLE_PATTERNS.some((re) => re.test(trimmed));
}

type FeedConfig = {
  url: string;
  source: string;
};

const FEEDS: FeedConfig[] = [
  { url: "https://feeds.bbci.co.uk/news/world/rss.xml", source: "BBC News" },
  { url: "https://www.theguardian.com/world/rss", source: "The Guardian" },
  {
    url: "https://www.aljazeera.com/xml/rss/all.xml",
    source: "Al Jazeera English",
  },
  {
    url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
    source: "The New York Times",
  },
  { url: "https://importai.substack.com/feed", source: "Import AI" },
  { url: "https://openai.com/blog/rss.xml", source: "OpenAI" },
  { url: "https://hnrss.org/frontpage?points=300", source: "Hacker News" },
  {
    url: "https://news.google.com/rss/search?q=anthropic&hl=en-US&gl=US&ceid=US:en",
    source: "Google News",
  },
  {
    url: "https://news.google.com/rss/search?q=deepmind&hl=en-US&gl=US&ceid=US:en",
    source: "Google News",
  },
];

function toHttpUrl(value: unknown, base?: string): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (!base) return null;
  try {
    return new URL(trimmed, base).toString();
  } catch {
    return null;
  }
}

function readNestedUrl(node: unknown, base?: string): string | null {
  if (!node) return null;
  if (typeof node === "string") return toHttpUrl(node, base);
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = readNestedUrl(item, base);
      if (found) return found;
    }
    return null;
  }
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const direct =
      toHttpUrl(obj.url, base) ??
      toHttpUrl(obj.href, base) ??
      toHttpUrl(obj.src, base) ??
      toHttpUrl(
        obj["$"] && typeof obj["$"] === "object"
          ? (obj["$"] as Record<string, unknown>).url
          : null,
        base,
      );
    if (direct) return direct;
    for (const value of Object.values(obj)) {
      const found = readNestedUrl(value, base);
      if (found) return found;
    }
  }
  return null;
}

function extractImageFromHtml(html: unknown, base?: string): string | null {
  if (typeof html !== "string" || html.trim().length === 0) return null;

  const patterns = [
    /<img[^>]+(?:src|data-src|data-lazy-src|data-original)=["']([^"']+)["']/i,
    /<source[^>]+srcset=["']([^"']+)["']/i,
  ];

  for (const re of patterns) {
    const match = html.match(re);
    if (!match?.[1]) continue;
    const srcset = match[1].trim();
    const first = srcset.split(",")[0]?.trim().split(/\s+/)[0] ?? srcset;
    const normalized = toHttpUrl(first, base);
    if (normalized) return normalized;
  }

  return null;
}

function extractRssImage(item: unknown, articleUrl?: string): string | null {
  if (!item || typeof item !== "object") return null;
  const obj = item as Record<string, unknown>;

  const candidates: unknown[] = [
    obj.enclosure,
    obj["media:content"],
    obj.mediaContent,
    obj["media:thumbnail"],
    obj.mediaThumbnail,
    obj["media:group"],
    obj.mediaGroup,
    obj["content:encoded"],
    obj.contentEncoded,
    obj.itunes,
    obj.image,
    obj.thumbnail,
  ];

  for (const candidate of candidates) {
    const found = readNestedUrl(candidate, articleUrl);
    if (found) return found;
  }

  const htmlFallback =
    extractImageFromHtml(obj["content:encoded"], articleUrl) ??
    extractImageFromHtml(obj.contentEncoded, articleUrl) ??
    extractImageFromHtml(obj.content, articleUrl) ??
    extractImageFromHtml(obj.summary, articleUrl);
  if (htmlFallback) return htmlFallback;

  return null;
}

async function fetchFeed({
  url,
  source,
}: FeedConfig): Promise<FetchedArticle[]> {
  try {
    const feed = await parser.parseURL(url);
    const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    return feed.items
      .map((item): FetchedArticle | null => {
        if (!item.title || !item.link) return null;
        if (isPlaceholderTitle(item.title)) return null;
        const publishedAt = item.isoDate
          ? new Date(item.isoDate)
          : item.pubDate
            ? new Date(item.pubDate)
            : new Date();
        if (publishedAt.getTime() < cutoff) return null;
        const imageUrl = extractRssImage(item, item.link);
        return {
          title: cleanTitle(item.title),
          url: item.link,
          source,
          publishedAt,
          snippet: cleanSnippet(item.contentSnippet ?? item.content ?? null),
          imageUrl,
          tagIds: [],
          isHeadline: true,
        };
      })
      .filter((a): a is FetchedArticle => a !== null);
  } catch (err) {
    console.error(`RSS feed ${source} failed:`, err);
    return [];
  }
}

export async function fetchAllRssFeeds(): Promise<FetchedArticle[]> {
  const results = await Promise.all(FEEDS.map(fetchFeed));
  return results.flat();
}
