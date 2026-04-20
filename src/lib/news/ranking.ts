import type { FetchedArticle } from "./types";

const SOURCE_WEIGHTS: Record<string, number> = {
  "BBC News": 1.0,
  "The Guardian": 1.0,
  Reuters: 1.0,
  "Associated Press": 1.0,
  "AP News": 1.0,
  "The New York Times": 1.0,
  "The Washington Post": 1.0,
  "Al Jazeera English": 1.0,
  Bloomberg: 1.0,
};

const DEFAULT_SOURCE_WEIGHT = 0.5;

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "has",
  "have",
  "he",
  "her",
  "him",
  "his",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "s",
  "said",
  "says",
  "she",
  "so",
  "than",
  "that",
  "the",
  "their",
  "them",
  "they",
  "this",
  "to",
  "was",
  "we",
  "were",
  "will",
  "with",
  "you",
  "your",
]);

function tokenize(title: string): Set<string> {
  const words = title
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  return new Set(words);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection++;
  const union = a.size + b.size - intersection;
  return intersection / union;
}

export type ClusteredArticle = FetchedArticle & {
  clusterId: string;
  score: number;
};

export function clusterAndScore(
  articles: FetchedArticle[],
  hasActiveTagBonus: (article: FetchedArticle) => boolean,
): ClusteredArticle[] {
  const tokenized = articles.map((a) => ({ article: a, tokens: tokenize(a.title) }));

  const clusters: { id: string; members: number[] }[] = [];

  tokenized.forEach((entry, i) => {
    let assigned = false;
    for (const cluster of clusters) {
      const repIdx = cluster.members[0];
      const rep = tokenized[repIdx];
      if (jaccard(entry.tokens, rep.tokens) > 0.6) {
        cluster.members.push(i);
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      clusters.push({ id: `c_${Date.now()}_${i}`, members: [i] });
    }
  });

  const clusterByArticle = new Map<number, { id: string; size: number }>();
  for (const c of clusters) {
    for (const idx of c.members) {
      clusterByArticle.set(idx, { id: c.id, size: c.members.length });
    }
  }

  const now = Date.now();
  return tokenized.map(({ article }, i) => {
    const cluster = clusterByArticle.get(i)!;
    const clusterSizeNorm = Math.min(1, cluster.size / 5);

    const hoursOld = Math.max(
      0,
      (now - article.publishedAt.getTime()) / (1000 * 60 * 60),
    );
    const recency = Math.exp(-hoursOld / 24);

    const sourceWeight =
      SOURCE_WEIGHTS[article.source] ?? DEFAULT_SOURCE_WEIGHT;

    const tagBonus = hasActiveTagBonus(article) ? 1 : 0;

    const score =
      0.4 * clusterSizeNorm +
      0.3 * recency +
      0.2 * sourceWeight +
      0.1 * tagBonus;

    return { ...article, clusterId: cluster.id, score };
  });
}

export function dedupeByUrl(articles: FetchedArticle[]): FetchedArticle[] {
  const byUrl = new Map<string, FetchedArticle>();
  for (const a of articles) {
    const existing = byUrl.get(a.url);
    if (!existing) {
      byUrl.set(a.url, a);
    } else {
      const mergedTagIds = Array.from(
        new Set([...existing.tagIds, ...a.tagIds]),
      );
      byUrl.set(a.url, { ...existing, tagIds: mergedTagIds });
    }
  }
  return Array.from(byUrl.values());
}
