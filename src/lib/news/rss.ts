import Parser from "rss-parser";
import type { FetchedArticle } from "./types";

const parser = new Parser({ timeout: 10000 });

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
];

async function fetchFeed({
  url,
  source,
}: FeedConfig): Promise<FetchedArticle[]> {
  try {
    const feed = await parser.parseURL(url);
    return feed.items
      .map((item): FetchedArticle | null => {
        if (!item.title || !item.link) return null;
        return {
          title: item.title,
          url: item.link,
          source,
          publishedAt: item.isoDate
            ? new Date(item.isoDate)
            : item.pubDate
              ? new Date(item.pubDate)
              : new Date(),
          snippet: item.contentSnippet ?? item.content ?? null,
          imageUrl: null,
          tagIds: [],
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
