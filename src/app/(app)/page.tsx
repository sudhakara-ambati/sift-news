import { Suspense } from "react";
import { prisma } from "@/lib/db";
import ArticleList from "@/components/ArticleList";
import TagChips from "@/components/TagChips";
import ScrollRestore from "@/components/ScrollRestore";

export const dynamic = "force-dynamic";

const FEED_LIMIT = 50;
const OVERFETCH = 200;
// Per-source cap in the top of the feed so one outlet (e.g. The Verge's
// high-volume AI coverage) can't own 70% of the list. A softer tail cap
// applies once the top is full so we still reach FEED_LIMIT.
const PER_SOURCE_CAP_TOP = 2;
const TOP_WINDOW = 15;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string; view?: string }>;
}) {
  const { tag: tagId, view } = await searchParams;

  // Feed filter: tag chip wins, then view=all (any tagged article), then
  // default (isHeadline = true — global top-headlines + RSS + lab domains).
  const where = tagId
    ? { tags: { some: { tagId } } }
    : view === "all"
      ? { tags: { some: {} } }
      : { isHeadline: true };

  const [tags, candidates] = await Promise.all([
    prisma.tag.findMany({ orderBy: { name: "asc" } }),
    prisma.article.findMany({
      where,
      orderBy: { score: "desc" },
      take: OVERFETCH,
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
    }),
  ]);

  const primaryByCluster = new Map<string, (typeof candidates)[number]>();
  const clusterPool: typeof candidates = [];
  for (const article of candidates) {
    const key = article.clusterId ?? `solo_${article.id}`;
    if (primaryByCluster.has(key)) continue;
    primaryByCluster.set(key, article);
    clusterPool.push(article);
  }

  // Two-pass selection: fill the top window with at most PER_SOURCE_CAP_TOP
  // articles per source (diversity), then backfill to FEED_LIMIT from the
  // remaining pool (completeness).
  const primaries: typeof candidates = [];
  const perSourceTop = new Map<string, number>();
  const deferred: typeof candidates = [];
  for (const article of clusterPool) {
    if (primaries.length >= TOP_WINDOW) {
      deferred.push(article);
      continue;
    }
    const count = perSourceTop.get(article.source) ?? 0;
    if (count >= PER_SOURCE_CAP_TOP) {
      deferred.push(article);
      continue;
    }
    primaries.push(article);
    perSourceTop.set(article.source, count + 1);
  }
  for (const article of deferred) {
    if (primaries.length >= FEED_LIMIT) break;
    primaries.push(article);
  }

  const clusterIds = primaries
    .map((p) => p.clusterId)
    .filter((id): id is string => !!id);

  const memberRows = clusterIds.length
    ? await prisma.article.findMany({
        where: { clusterId: { in: clusterIds } },
        select: { id: true, clusterId: true, source: true },
      })
    : [];

  const othersByCluster = new Map<string, string[]>();
  for (const m of memberRows) {
    if (!m.clusterId) continue;
    const primaryId = primaryByCluster.get(m.clusterId)?.id;
    if (!primaryId || m.id === primaryId) continue;
    if (!othersByCluster.has(m.clusterId)) othersByCluster.set(m.clusterId, []);
    othersByCluster.get(m.clusterId)!.push(m.source);
  }

  const articles = primaries.map((p) => ({
    id: p.id,
    title: p.title,
    url: p.url,
    source: p.source,
    publishedAt: p.publishedAt,
    snippet: p.snippet,
    imageUrl: p.imageUrl,
    otherSources: p.clusterId ? othersByCluster.get(p.clusterId) ?? [] : [],
  }));

  const activeTag = tagId ? tags.find((t) => t.id === tagId) : null;
  const activeView: "general" | "all" | "tag" = activeTag
    ? "tag"
    : view === "all"
      ? "all"
      : "general";

  return (
    <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-8">
      <Suspense fallback={null}>
        <ScrollRestore />
      </Suspense>
      <div className="no-scrollbar mb-8 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:mb-10 sm:px-0">
        <TagChips
          tags={tags}
          activeTagId={activeTag?.id ?? null}
          activeView={activeView}
        />
      </div>
      <ArticleList articles={articles} />
    </div>
  );
}
