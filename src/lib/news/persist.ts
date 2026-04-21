import { prisma } from "@/lib/db";
import { fetchEverythingForTag } from "@/lib/news/newsapi";
import {
  clusterAndScore,
  dedupeByUrl,
  extractDistinctiveTerms,
} from "@/lib/news/ranking";
import { filterBlockedArticles } from "@/lib/news/filters";
import { hydrateImages } from "@/lib/news/og-image";
import type { FetchedArticle } from "@/lib/news/types";
import type { ClusteredArticle } from "@/lib/news/ranking";

export type PersistCounts = { inserted: number; updated: number };

export async function persistScoredArticles(
  scored: ClusteredArticle[],
): Promise<PersistCounts> {
  let inserted = 0;
  let updated = 0;

  for (const article of scored) {
    const existing = await prisma.article.findUnique({
      where: { url: article.url },
      select: { id: true, isHeadline: true },
    });

    // OR-upsert on isHeadline: once an article has been ingested via a
    // general/RSS/lab source, a later tag-only refetch must not demote it.
    const isHeadline = existing
      ? existing.isHeadline || article.isHeadline
      : article.isHeadline;

    const fields = {
      title: article.title,
      source: article.source,
      publishedAt: article.publishedAt,
      snippet: article.snippet,
      imageUrl: article.imageUrl,
      clusterId: article.clusterId,
      score: article.score,
      isHeadline,
    };

    const articleId = existing
      ? (
          await prisma.article.update({
            where: { id: existing.id },
            data: fields,
            select: { id: true },
          })
        ).id
      : (
          await prisma.article.create({
            data: { ...fields, url: article.url },
            select: { id: true },
          })
        ).id;

    if (existing) updated++;
    else inserted++;

    for (const tagId of article.tagIds) {
      await prisma.articleTag.upsert({
        where: { articleId_tagId: { articleId, tagId } },
        create: { articleId, tagId },
        update: {},
      });
    }
  }

  return { inserted, updated };
}

export async function runTagFetch(
  tagId: string,
  queryTerms: string,
): Promise<PersistCounts & { fetched: number }> {
  const raw = await fetchEverythingForTag(tagId, queryTerms);
  const filtered = filterBlockedArticles(raw);
  const deduped = dedupeByUrl(filtered);
  const scored = clusterAndScore(
    deduped,
    (article: FetchedArticle) => article.tagIds.length > 0,
    extractDistinctiveTerms(queryTerms),
  );

  const ranked = [...scored].sort((a, b) => b.score - a.score);

  const persistLimit = Number.parseInt(
    process.env.TAG_PERSIST_LIMIT ?? "120",
    10,
  );
  const toPersist =
    Number.isFinite(persistLimit) && persistLimit > 0
      ? ranked.slice(0, persistLimit)
      : ranked;

  const enableOgHydration = process.env.HYDRATE_OG_IMAGES === "1";
  const hydrationLimit = Number.parseInt(
    process.env.HYDRATE_OG_IMAGES_LIMIT ?? "8",
    10,
  );

  let finalScored = toPersist;
  if (enableOgHydration) {
    const toHydrate = toPersist.slice(0, Math.max(0, hydrationLimit));
    const hydrated = await hydrateImages(toHydrate);
    const hydratedByUrl = new Map(hydrated.map((a) => [a.url, a]));
    finalScored = toPersist.map((a) => hydratedByUrl.get(a.url) ?? a);
  }

  const counts = await persistScoredArticles(finalScored);
  return { fetched: raw.length, ...counts };
}
