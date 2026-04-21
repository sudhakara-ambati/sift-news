import { prisma } from "@/lib/db";
import TagManager from "@/components/TagManager";

export const dynamic = "force-dynamic";

export default async function TagsPage() {
  const tags = await prisma.tag.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { articles: true } } },
  });

  const viewTags = tags.map((t) => ({
    id: t.id,
    name: t.name,
    queryTerms: t.queryTerms,
    articleCount: t._count.articles,
  }));

  return (
    <div className="mx-auto max-w-2xl px-4 py-5 sm:py-7">
      <div className="mb-6">
        <h2 className="text-lg font-semibold">Tags</h2>
        <p className="mt-1 text-sm text-white/60">
          Each tag uses NewsAPI <code>/everything</code> query syntax — phrase
          quotes keep matches tight. Single short tokens like{" "}
          <code>AI</code> match too much noise on their own.
        </p>
      </div>
      <TagManager tags={viewTags} />
    </div>
  );
}
