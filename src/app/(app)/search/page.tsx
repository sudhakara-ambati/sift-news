import { Suspense } from "react";
import { prisma } from "@/lib/db";
import ArticleList from "@/components/ArticleList";
import ScrollRestore from "@/components/ScrollRestore";
import { fetchEverythingForKeywords } from "@/lib/news/newsapi";
import { filterBlockedArticles } from "@/lib/news/filters";
import {
  clusterAndScore,
  dedupeByUrl,
  mergeDuplicateStories,
  type ClusteredArticle,
} from "@/lib/news/ranking";
import { hydrateImages } from "@/lib/news/og-image";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const RESULT_LIMIT = 40;

// Split on commas so multi-word terms like "Sam Altman" stay intact.
// Each term is quoted if it contains whitespace, so NewsAPI treats it as
// a phrase; single-word terms are passed bare.
function parseKeywords(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter(
      (s, i, arr) => arr.findIndex((x) => x.toLowerCase() === s.toLowerCase()) === i,
    );
}

function buildNewsApiQuery(keywords: string[]): string {
  return keywords
    .map((k) => `"${k.replace(/"/g, '\\"')}"`)
    .join(" OR ");
}

// Word-boundary match: "AI" doesn't trigger on "said", "Anthropic" doesn't
// trigger on "anthropics" (rare) but also doesn't mis-match substrings.
function hasWordBoundary(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|[^a-zA-Z0-9])${escaped}(?:[^a-zA-Z0-9]|$)`, "i");
  return re.test(haystack);
}

function searchRelevanceBonus(
  article: { title: string; snippet: string | null },
  keywords: string[],
): number {
  const titleHits = keywords.filter((k) =>
    hasWordBoundary(article.title, k),
  ).length;
  const snippetHits =
    article.snippet &&
    keywords.some((k) => hasWordBoundary(article.snippet as string, k))
      ? 1
      : 0;
  // Title hit is a +1 floor — bigger than any base-score contribution — so a
  // true title match always beats a no-title-match article. Extra hits add
  // a small bump; snippet-only match adds +0.3.
  if (titleHits > 0) return 1 + (titleHits - 1) * 0.1;
  if (snippetHits) return 0.3;
  return 0;
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q: raw } = await searchParams;
  const keywords = raw ? parseKeywords(raw) : [];
  const hasQuery = keywords.length > 0;

  let articles: React.ComponentProps<typeof ArticleList>["articles"] = [];
  let error: string | null = null;
  let newsapiHitCount = 0;

  if (hasQuery) {
    try {
      const query = buildNewsApiQuery(keywords);
      const fetched = await fetchEverythingForKeywords(query);
      newsapiHitCount = fetched.length;
      const filtered = filterBlockedArticles(fetched);
      const deduped = dedupeByUrl(filtered);
      const scored = clusterAndScore(deduped, () => false, []);

      // Pick one primary per cluster (highest base score) so near-duplicate
      // stories don't crowd the result list.
      const primaryByCluster = new Map<string, ClusteredArticle>();
      for (const a of [...scored].sort((x, y) => y.score - x.score)) {
        if (!primaryByCluster.has(a.clusterId))
          primaryByCluster.set(a.clusterId, a);
      }
      const primaries = Array.from(primaryByCluster.values());

      // Rerank: search relevance (title > snippet) dominates, base score
      // (cluster size, source weight, recency) breaks ties within tiers.
      const ranked = [...primaries].sort((a, b) => {
        const bonusA = searchRelevanceBonus(a, keywords);
        const bonusB = searchRelevanceBonus(b, keywords);
        return bonusB + b.score - (bonusA + a.score);
      });
      const top = ranked.slice(0, RESULT_LIMIT);

      const hydrated = await hydrateImages(top);
      const hydratedByUrl = new Map(hydrated.map((a) => [a.url, a]));
      const finalTop = top.map((a) => hydratedByUrl.get(a.url) ?? a);

      // Upsert inline so we collect IDs directly rather than relying on a
      // follow-up findMany — that second round-trip has been observed to
      // return empty on Vercel when the write replica hadn't propagated yet
      // to the read path, surfacing as a spurious "No results" page.
      const persisted = await Promise.all(
        finalTop.map(async (a) => {
          try {
            const upserted = await prisma.article.upsert({
              where: { url: a.url },
              create: {
                title: a.title,
                url: a.url,
                source: a.source,
                publishedAt: a.publishedAt,
                snippet: a.snippet,
                imageUrl: a.imageUrl ?? null,
                clusterId: a.clusterId,
                score: a.score,
                isHeadline: false,
              },
              update: {
                title: a.title,
                source: a.source,
                publishedAt: a.publishedAt,
                snippet: a.snippet,
                clusterId: a.clusterId,
                score: a.score,
                ...(a.imageUrl ? { imageUrl: a.imageUrl } : {}),
              },
              select: {
                id: true,
                title: true,
                url: true,
                source: true,
                publishedAt: true,
                snippet: true,
                imageUrl: true,
                clusterId: true,
              },
            });
            return upserted;
          } catch (err) {
            console.error("search upsert failed:", a.url, err);
            return null;
          }
        }),
      );
      const persistedArticles = persisted.filter(
        (a): a is NonNullable<typeof a> => !!a,
      );

      // Cluster IDs across DB runs can fragment near-duplicate stories, so
      // do the same post-selection merge the home feed uses.
      const { primaries: mergedPrimaries, othersByPrimary } =
        mergeDuplicateStories(persistedArticles);

      articles = mergedPrimaries.map((a) => ({
        id: a.id,
        title: a.title,
        url: a.url,
        source: a.source,
        publishedAt: a.publishedAt,
        snippet: a.snippet,
        imageUrl: a.imageUrl,
        otherSources: (othersByPrimary.get(a.id) ?? []).filter(
          (s) => s !== a.source,
        ),
      }));
    } catch (err) {
      console.error("search failed:", err);
      error = "Search failed — try again.";
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-8">
      <Suspense fallback={null}>
        <ScrollRestore />
      </Suspense>

      <header className="mb-8 sm:mb-10">
        <h1 className="font-serif text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          Search
        </h1>
        {hasQuery ? (
          <p className="mt-2 text-sm text-white/55">
            Results for{" "}
            {keywords.map((k, i) => (
              <span key={`${k}-${i}`}>
                {i > 0 && <span className="text-white/30">, </span>}
                <span className="text-white/80">{k}</span>
              </span>
            ))}
          </p>
        ) : (
          <p className="mt-2 text-sm text-white/55">
            Enter comma-separated keywords in the header to search. Example:
            <span className="ml-1 font-mono text-white/75">
              OpenAI, Sam Altman, ChatGPT
            </span>
          </p>
        )}
      </header>

      {error ? (
        <div className="rounded-lg border border-white/10 p-10 text-center text-sm text-white/55">
          {error}
        </div>
      ) : hasQuery && articles.length === 0 ? (
        <div className="rounded-lg border border-white/10 p-10 text-center text-sm text-white/55">
          {newsapiHitCount === 0
            ? "No news found for those keywords. Try different ones — or the daily NewsAPI budget may be exhausted."
            : "No results. Try fewer or different keywords."}
        </div>
      ) : hasQuery ? (
        <ArticleList articles={articles} />
      ) : null}
    </div>
  );
}
