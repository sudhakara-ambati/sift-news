import type { FetchedArticle } from "./types";

const SOURCE_WEIGHTS: Record<string, number> = {
  // Tier 1 (1.0) — international wires + major newspapers of record
  "BBC News": 1.0,
  "The Guardian": 1.0,
  Reuters: 1.0,
  "Associated Press": 1.0,
  "AP News": 1.0,
  "The New York Times": 1.0,
  "The Washington Post": 1.0,
  "Al Jazeera English": 1.0,
  Bloomberg: 1.0,
  "Financial Times": 1.0,
  "The Wall Street Journal": 1.0,
  "The Economist": 1.0,
  // AI primary (1.0) — lab direct sources
  "Import AI": 1.0,
  OpenAI: 1.0,
  Anthropic: 1.0,
  "Google DeepMind": 1.0,
  DeepMind: 1.0,
  // Tier 2 (0.85) — respected general + quality tech
  Axios: 0.85,
  Politico: 0.85,
  NPR: 0.85,
  "PBS NewsHour": 0.85,
  "Sky News": 0.85,
  "The Telegraph": 0.85,
  "The Independent": 0.85,
  "The Times": 0.85,
  "MIT Technology Review": 0.9,
  "Nature": 0.9,
  "TechCrunch": 0.85,
  "The Verge": 0.85,
  Wired: 0.85,
  "Ars Technica": 0.85,
  // Tier 3 (0.7) — big US broadcast + business
  CNN: 0.7,
  "CBS News": 0.7,
  "NBC News": 0.7,
  "ABC News": 0.7,
  CNBC: 0.7,
  "Fox News": 0.65,
  Engadget: 0.7,
  // Aggregators
  "Hacker News": 0.7,
  "Google News": 0.6,
};

const DEFAULT_SOURCE_WEIGHT = 0.25;

// Collapse a source name to a loose key. NewsAPI emits "Skynews.com", RSS
// emits "Sky News", JSON-LD might emit "SKY NEWS" — all must match. Strips
// leading "The ", lowercases, then drops every non-alphanumeric character,
// so "Sky News" and "Skynews.com" both become "skynews".
function normaliseSourceName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/\.(com|org|net|co\.uk|co|news|tv|io|ai)$/, "")
    .replace(/[^a-z0-9]/g, "");
}

const NORMALISED_SOURCE_WEIGHTS: Map<string, number> = new Map(
  Object.entries(SOURCE_WEIGHTS).map(([k, v]) => [normaliseSourceName(k), v]),
);

// Hostname fallback — covers outlets where NewsAPI's source.name is a
// domain string ("Nytimes.com") whose alphanum form doesn't match the
// display key ("new york times"). Hostnames are stable identity.
const HOSTNAME_WEIGHTS: Record<string, number> = {
  "bbc.co.uk": 1.0,
  "bbc.com": 1.0,
  "theguardian.com": 1.0,
  "reuters.com": 1.0,
  "apnews.com": 1.0,
  "nytimes.com": 1.0,
  "washingtonpost.com": 1.0,
  "aljazeera.com": 1.0,
  "bloomberg.com": 1.0,
  "ft.com": 1.0,
  "wsj.com": 1.0,
  "economist.com": 1.0,
  "anthropic.com": 1.0,
  "openai.com": 1.0,
  "deepmind.google": 1.0,
  "deepmind.com": 1.0,
  "importai.substack.com": 1.0,
  "axios.com": 0.85,
  "politico.com": 0.85,
  "politico.eu": 0.85,
  "npr.org": 0.85,
  "pbs.org": 0.85,
  "sky.com": 0.85,
  "news.sky.com": 0.85,
  "skynews.com": 0.85,
  "telegraph.co.uk": 0.85,
  "independent.co.uk": 0.85,
  "thetimes.co.uk": 0.85,
  "thetimes.com": 0.85,
  "technologyreview.com": 0.9,
  "nature.com": 0.9,
  "techcrunch.com": 0.85,
  "theverge.com": 0.85,
  "wired.com": 0.85,
  "arstechnica.com": 0.85,
  "cnn.com": 0.7,
  "edition.cnn.com": 0.7,
  "cbsnews.com": 0.7,
  "nbcnews.com": 0.7,
  "abcnews.go.com": 0.7,
  "cnbc.com": 0.7,
  "foxnews.com": 0.65,
  "engadget.com": 0.7,
  "news.ycombinator.com": 0.7,
  "news.google.com": 0.6,
};

function hostnameWeight(url: string): number | undefined {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
  if (HOSTNAME_WEIGHTS[host] !== undefined) return HOSTNAME_WEIGHTS[host];
  // Walk up subdomains (news.example.com → example.com) for a broader match.
  const parts = host.split(".");
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join(".");
    if (HOSTNAME_WEIGHTS[parent] !== undefined) return HOSTNAME_WEIGHTS[parent];
  }
  return undefined;
}

function sourceWeightFor(source: string, url?: string): number {
  const exact = SOURCE_WEIGHTS[source];
  if (exact !== undefined) return exact;
  const norm = NORMALISED_SOURCE_WEIGHTS.get(normaliseSourceName(source));
  if (norm !== undefined) return norm;
  if (url) {
    const host = hostnameWeight(url);
    if (host !== undefined) return host;
  }
  return DEFAULT_SOURCE_WEIGHT;
}

const PRIMARY_AI_SOURCES = new Set([
  "Anthropic.com",
  "Deepmind.google",
  "OpenAI",
  "Import AI",
]);
const PRIMARY_AI_SOURCE_BOOST = 0.1;

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
  "after",
  "amid",
  "new",
  "latest",
  "over",
  "report",
  "reports",
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

// Extract the "distinctive" terms from a NewsAPI boolean query — quoted
// phrases and capitalised proper-noun-ish bare tokens. Booleans, parens,
// stopwords, and lowercase filler are dropped. Returned lowercase for
// case-insensitive title matching.
export function extractDistinctiveTerms(queryTerms: string): string[] {
  const terms = new Set<string>();
  const quoted = queryTerms.match(/"[^"]+"/g);
  if (quoted) {
    for (const q of quoted) {
      const inner = q.slice(1, -1).trim();
      if (inner.length >= 3) terms.add(inner.toLowerCase());
    }
  }
  const bare = queryTerms
    .replace(/"[^"]+"/g, " ")
    .replace(/\b(AND|OR|NOT)\b/g, " ")
    .replace(/[()]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  for (const t of bare) {
    // Proper nouns, all-caps acronyms, or mixed-case product names (xAI, GPT-5).
    const isProperish = /^[A-Z]/.test(t) || /^[a-z]+[A-Z]/.test(t);
    if (!isProperish) continue;
    if (t.length < 3) continue;
    terms.add(t.toLowerCase());
  }
  return [...terms];
}

// Attach tag IDs to any article whose title OR source contains a distinctive
// term from that tag's query. Lets lab-site / top-headline / RSS articles
// reach tag pages — e.g. an anthropic.com post on `Claude 3.7` gets the AI
// tag even though the pipeline fetched it by domain, not via the AI query.
// Existing tagIds are preserved; only additions happen.
export function autoTagArticles(
  articles: FetchedArticle[],
  tags: { id: string; queryTerms: string }[],
): FetchedArticle[] {
  if (tags.length === 0) return articles;
  const tagTerms = tags.map((t) => ({
    id: t.id,
    terms: extractDistinctiveTerms(t.queryTerms),
  }));
  return articles.map((a) => {
    const haystack = `${a.title} ${a.source}`.toLowerCase();
    const nextTagIds = new Set(a.tagIds);
    for (const { id, terms } of tagTerms) {
      if (nextTagIds.has(id)) continue;
      if (terms.some((t) => haystack.includes(t))) nextTagIds.add(id);
    }
    if (nextTagIds.size === a.tagIds.length) return a;
    return { ...a, tagIds: [...nextTagIds] };
  });
}

export function clusterAndScore(
  articles: FetchedArticle[],
  hasActiveTagBonus: (article: FetchedArticle) => boolean,
  titleMatchTerms: string[] = [],
): ClusteredArticle[] {
  const tokenized = articles.map((a) => ({ article: a, tokens: tokenize(a.title) }));

  const clusters: { id: string; members: number[] }[] = [];

  tokenized.forEach((entry, i) => {
    let assigned = false;
    for (const cluster of clusters) {
      const repIdx = cluster.members[0];
      const rep = tokenized[repIdx];
      if (jaccard(entry.tokens, rep.tokens) > 0.45) {
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
    // Log-scale cluster size: size 1→0.33, 2→0.53, 3→0.67, 5→0.86, 8+→1.0.
    // Distinguishes "big story" (8 outlets) from "modest coverage" (3).
    const clusterSizeNorm = Math.min(
      1,
      Math.log(cluster.size + 1) / Math.log(9),
    );

    const hoursOld = Math.max(
      0,
      (now - article.publishedAt.getTime()) / (1000 * 60 * 60),
    );
    // 36h half-life — biggest stories often have multi-day legs.
    const recency = Math.exp(-hoursOld / 36);

    const sourceWeight = sourceWeightFor(article.source, article.url);

    const tagBonus = hasActiveTagBonus(article) ? 1 : 0;

    const primaryBoost = PRIMARY_AI_SOURCES.has(article.source)
      ? PRIMARY_AI_SOURCE_BOOST
      : 0;

    // Title-match boost: if any distinctive tag query token appears in the
    // title, the article is clearly "about" the tag, not tangential.
    const titleMatchBoost =
      tagBonus && titleMatchTerms.length > 0
        ? titleMatchStrength(article, titleMatchTerms)
        : 0;

    const score =
      0.35 * clusterSizeNorm + // biggest
      0.3 * sourceWeight + // most popular
      0.2 * recency + // right now
      0.1 * tagBonus + // tag membership
      0.05 * titleMatchBoost + // article IS about it, not tangential
      primaryBoost;

    return { ...article, clusterId: cluster.id, score };
  });
}

function titleMatchStrength(
  article: FetchedArticle,
  terms: string[],
): number {
  const title = article.title.toLowerCase();
  let hits = 0;
  for (const t of terms) {
    if (title.includes(t)) hits++;
    if (hits >= 2) return 1;
  }
  return hits >= 1 ? 0.6 : 0;
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
