import { prisma } from "@/lib/db";
import {
  fetchEverythingForDomains,
  fetchEverythingForTag,
  fetchTopHeadlinesGeneral,
  fetchTopHeadlinesSources,
} from "@/lib/news/newsapi";
import { fetchAllRssFeeds } from "@/lib/news/rss";
import {
  autoTagArticles,
  clusterAndScore,
  dedupeByUrl,
  extractDistinctiveTerms,
} from "@/lib/news/ranking";
import { filterBlockedArticles, isBlockedUrl } from "@/lib/news/filters";
import { persistScoredArticles } from "@/lib/news/persist";
import { hydrateImages } from "@/lib/news/og-image";
import type { FetchedArticle } from "@/lib/news/types";

const AI_LAB_DOMAINS = "anthropic.com,deepmind.google";
const DEFAULT_PERSIST_LIMIT = 250;
const DEFAULT_IMAGE_HYDRATION_LIMIT = 12;
const DEFAULT_IMAGE_BACKFILL_LIMIT = 0;

export async function backfillMissingImages(
  limit = DEFAULT_IMAGE_BACKFILL_LIMIT,
): Promise<number> {
  const candidates = await prisma.article.findMany({
    where: { imageUrl: null },
    orderBy: { score: "desc" },
    take: limit,
    select: { id: true, url: true, imageUrl: true },
  });
  if (candidates.length === 0) return 0;

  const hydrated = await hydrateImages(candidates);
  let updated = 0;
  for (const a of hydrated) {
    if (!a.imageUrl) continue;
    await prisma.article.update({
      where: { id: a.id },
      data: { imageUrl: a.imageUrl },
    });
    updated++;
  }
  return updated;
}

export type FetchRunResult = {
  counts: {
    fetched: number;
    blocked: number;
    deduped: number;
    inserted: number;
    updated: number;
  };
  sources: {
    newsapiGeneral: number;
    newsapiSources: number;
    newsapiLabDomains: number;
    rss: number;
    newsapiTags: number;
  };
};

export async function purgeBlockedArticles(): Promise<number> {
  const candidates = await prisma.article.findMany({ select: { id: true, url: true } });
  const toDelete = candidates.filter((a) => isBlockedUrl(a.url)).map((a) => a.id);
  if (toDelete.length === 0) return 0;
  const res = await prisma.article.deleteMany({ where: { id: { in: toDelete } } });
  return res.count;
}

export async function runFetchPipeline(): Promise<FetchRunResult> {
  await purgeBlockedArticles();
  const activeTags = await prisma.tag.findMany();

  const [
    generalHeadlines,
    sourceHeadlines,
    labDomainItems,
    rssItems,
    ...tagResults
  ] = await Promise.all([
    fetchTopHeadlinesGeneral(),
    fetchTopHeadlinesSources(),
    fetchEverythingForDomains(AI_LAB_DOMAINS),
    fetchAllRssFeeds(),
    ...activeTags.map((t) => fetchEverythingForTag(t.id, t.queryTerms)),
  ]);

  const all: FetchedArticle[] = [
    ...generalHeadlines,
    ...sourceHeadlines,
    ...labDomainItems,
    ...rssItems,
    ...tagResults.flat(),
  ];

  const filtered = filterBlockedArticles(all);
  const deduped = dedupeByUrl(filtered);
  const autoTagged = autoTagArticles(deduped, activeTags);
  const allTitleMatchTerms = Array.from(
    new Set(
      activeTags.flatMap((t) => extractDistinctiveTerms(t.queryTerms)),
    ),
  );
  const scored = clusterAndScore(
    autoTagged,
    (a) => a.tagIds.length > 0,
    allTitleMatchTerms,
  );

  const ranked = [...scored].sort((a, b) => b.score - a.score);

  // Turso + Vercel cron runs can time out if we do heavy OG-image hydration
  // or try to upsert hundreds of rows. Keep the cron fast by default; opt in
  // via env vars if you want richer image coverage.
  const persistLimit = Number.parseInt(
    process.env.CRON_PERSIST_LIMIT ?? `${DEFAULT_PERSIST_LIMIT}`,
    10,
  );

  const enableOgHydration = process.env.HYDRATE_OG_IMAGES === "1";
  const hydrationLimit = Number.parseInt(
    process.env.HYDRATE_OG_IMAGES_LIMIT ?? `${DEFAULT_IMAGE_HYDRATION_LIMIT}`,
    10,
  );

  const toPersist = Number.isFinite(persistLimit) && persistLimit > 0
    ? ranked.slice(0, persistLimit)
    : ranked;

  let finalScored = toPersist;
  if (enableOgHydration) {
    const toHydrate = toPersist.slice(0, Math.max(0, hydrationLimit));
    const hydrated = await hydrateImages(toHydrate);
    const hydratedByUrl = new Map(hydrated.map((a) => [a.url, a]));
    finalScored = toPersist.map((a) => hydratedByUrl.get(a.url) ?? a);
  }

  const { inserted, updated } = await persistScoredArticles(finalScored);

  const backfillLimit = Number.parseInt(
    process.env.BACKFILL_OG_IMAGES_LIMIT ?? `${DEFAULT_IMAGE_BACKFILL_LIMIT}`,
    10,
  );
  if (Number.isFinite(backfillLimit) && backfillLimit > 0) {
    await backfillMissingImages(backfillLimit);
  }

  return {
    counts: {
      fetched: all.length,
      blocked: all.length - filtered.length,
      deduped: deduped.length,
      inserted,
      updated,
    },
    sources: {
      newsapiGeneral: generalHeadlines.length,
      newsapiSources: sourceHeadlines.length,
      newsapiLabDomains: labDomainItems.length,
      rss: rssItems.length,
      newsapiTags: tagResults.reduce((n, arr) => n + arr.length, 0),
    },
  };
}
