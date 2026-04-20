import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  fetchEverythingForTag,
  fetchTopHeadlinesGeneral,
  fetchTopHeadlinesSources,
} from "@/lib/news/newsapi";
import { fetchAllRssFeeds } from "@/lib/news/rss";
import { clusterAndScore, dedupeByUrl } from "@/lib/news/ranking";
import type { FetchedArticle } from "@/lib/news/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;

  const url = new URL(request.url);
  if (url.searchParams.get("secret") === secret) return true;

  return false;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const activeTags = await prisma.tag.findMany();

  const [generalHeadlines, sourceHeadlines, rssItems, ...tagResults] =
    await Promise.all([
      fetchTopHeadlinesGeneral(),
      fetchTopHeadlinesSources(),
      fetchAllRssFeeds(),
      ...activeTags.map((t) => fetchEverythingForTag(t.id, t.queryTerms)),
    ]);

  const all: FetchedArticle[] = [
    ...generalHeadlines,
    ...sourceHeadlines,
    ...rssItems,
    ...tagResults.flat(),
  ];

  const deduped = dedupeByUrl(all);

  const scored = clusterAndScore(deduped, (article) => article.tagIds.length > 0);

  let inserted = 0;
  let updated = 0;

  for (const article of scored) {
    const existing = await prisma.article.findUnique({
      where: { url: article.url },
      select: { id: true },
    });

    const fields = {
      title: article.title,
      source: article.source,
      publishedAt: article.publishedAt,
      snippet: article.snippet,
      imageUrl: article.imageUrl,
      clusterId: article.clusterId,
      score: article.score,
    };

    const articleId = existing
      ? (await prisma.article.update({
          where: { id: existing.id },
          data: fields,
          select: { id: true },
        })).id
      : (await prisma.article.create({
          data: { ...fields, url: article.url },
          select: { id: true },
        })).id;

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

  return NextResponse.json({
    ok: true,
    counts: {
      fetched: all.length,
      deduped: deduped.length,
      inserted,
      updated,
    },
    sources: {
      newsapiGeneral: generalHeadlines.length,
      newsapiSources: sourceHeadlines.length,
      rss: rssItems.length,
      newsapiTags: tagResults.reduce((n, arr) => n + arr.length, 0),
    },
  });
}
