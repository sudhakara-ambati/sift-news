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

// Attach a tag to existing DB articles whose title/source/snippet matches any
// of the tag's distinctive terms. Without this, newly-created or refreshed
// tags for popular topics (e.g. Gaza) appear empty because NewsAPI's
// `/everything` search returned few unique hits, even though the main feed
// already has dozens of relevant articles from top-headlines and RSS.
export async function attachTagToExistingArticles(
  tagId: string,
  queryTerms: string,
): Promise<number> {
  const terms = extractDistinctiveTerms(queryTerms);
  if (terms.length === 0) return 0;

  const matches = await prisma.article.findMany({
    where: {
      tags: { none: { tagId } },
      OR: terms.flatMap((t) => [
        { title: { contains: t } },
        { source: { contains: t } },
        { snippet: { contains: t } },
      ]),
    },
    select: { id: true },
    take: 500,
  });
  if (matches.length === 0) return 0;

  let attached = 0;
  await Promise.all(
    matches.map(async (m) => {
      try {
        await prisma.articleTag.create({
          data: { articleId: m.id, tagId },
        });
        attached++;
      } catch {
        // Duplicate (race with another writer) — ignore.
      }
    }),
  );
  return attached;
}

export type PersistCounts = { inserted: number; updated: number };

export async function persistScoredArticles(
  scored: ClusteredArticle[],
): Promise<PersistCounts> {
  let inserted = 0;
  let updated = 0;
  let errors = 0;

  const concurrency = Math.max(
    1,
    Number.parseInt(process.env.PERSIST_CONCURRENCY ?? "4", 10) || 4,
  );
  const queue = [...scored];

  async function processOne(article: ClusteredArticle) {
    const existing = await prisma.article.findUnique({
      where: { url: article.url },
      select: { id: true, isHeadline: true },
    });

    const nextImageUrl =
      typeof article.imageUrl === "string" && /^https?:\/\//i.test(article.imageUrl)
        ? article.imageUrl
        : null;

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
      clusterId: article.clusterId,
      score: article.score,
      isHeadline,
    };

    const articleId = existing
      ? (
          await prisma.article.update({
            where: { id: existing.id },
            // Preserve an existing DB image when the new payload has none.
            data: nextImageUrl ? { ...fields, imageUrl: nextImageUrl } : fields,
            select: { id: true },
          })
        ).id
      : (
          await prisma.article.create({
            data: { ...fields, imageUrl: nextImageUrl, url: article.url },
            select: { id: true },
          })
        ).id;

    if (existing) updated++;
    else inserted++;

    if (article.tagIds.length > 0) {
      await Promise.all(
        article.tagIds.map((tagId) =>
          prisma.articleTag.upsert({
            where: { articleId_tagId: { articleId, tagId } },
            create: { articleId, tagId },
            update: {},
          }),
        ),
      );
    }
  }

  async function worker() {
    while (queue.length > 0) {
      const article = queue.shift();
      if (!article) return;
      try {
        await processOne(article);
      } catch (err) {
        errors++;
        console.error("persistScoredArticles: failed to persist", article.url, err);
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, queue.length || 1) },
      () => worker(),
    ),
  );

  if (errors > 0) {
    console.warn(`persistScoredArticles: ${errors} errors while persisting`);
  }

  return { inserted, updated };
}

export async function runTagFetch(
  tagId: string,
  queryTerms: string,
): Promise<PersistCounts & { fetched: number; attached: number }> {
  // Two parallel tracks: pull fresh `/everything` hits AND retag any existing
  // DB articles whose content matches this tag's terms. The retag catches
  // the common case where NewsAPI returned 0 new hits but the general feed
  // already has matching coverage (e.g. Gaza headlines in top-headlines).
  const [raw, attached] = await Promise.all([
    fetchEverythingForTag(tagId, queryTerms),
    attachTagToExistingArticles(tagId, queryTerms),
  ]);
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
  return { fetched: raw.length, attached, ...counts };
}
