import { prisma } from "@/lib/db";
import ArticleList from "@/components/ArticleList";
import TagChips from "@/components/TagChips";

const FEED_LIMIT = 50;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string }>;
}) {
  const { tag: tagId } = await searchParams;

  const [tags, articles] = await Promise.all([
    prisma.tag.findMany({ orderBy: { name: "asc" } }),
    prisma.article.findMany({
      where: tagId ? { tags: { some: { tagId } } } : undefined,
      orderBy: { score: "desc" },
      take: FEED_LIMIT,
      select: {
        id: true,
        title: true,
        url: true,
        source: true,
        publishedAt: true,
        snippet: true,
        imageUrl: true,
      },
    }),
  ]);

  const activeTag = tagId ? tags.find((t) => t.id === tagId) : null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6">
        <TagChips tags={tags} activeTagId={activeTag?.id ?? null} />
      </div>
      <ArticleList articles={articles} />
    </div>
  );
}
