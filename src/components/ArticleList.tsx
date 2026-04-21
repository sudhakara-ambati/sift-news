import ArticleCard from "@/components/ArticleCard";

type Article = {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: Date;
  snippet: string | null;
  imageUrl: string | null;
  otherSources?: string[];
};

function SectionHeader({ label }: { label: string }) {
  return (
    <h2 className="mb-4 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.15em] text-white/60 sm:text-xs">
      <span className="h-px flex-none bg-white/25" style={{ width: 24 }} />
      {label}
    </h2>
  );
}

export default function ArticleList({ articles }: { articles: Article[] }) {
  if (articles.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 p-10 text-center text-sm text-white/55">
        No articles yet. Hit Refresh to fetch the feed.
      </div>
    );
  }

  const hero = articles[0];
  const topStories = articles.slice(1, 7);
  const rest = articles.slice(7);

  return (
    <div className="space-y-10 sm:space-y-12">
      <section>
        <ArticleCard article={hero} variant="hero" />
      </section>

      {topStories.length > 0 && (
        <section>
          <SectionHeader label="Top stories" />
          <div className="grid grid-cols-1 items-start gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {topStories.map((a) => (
              <ArticleCard key={a.id} article={a} variant="grid" />
            ))}
          </div>
        </section>
      )}

      {rest.length > 0 && (
        <section>
          <SectionHeader label="More stories" />
          <div className="grid grid-cols-1 gap-x-10 sm:grid-cols-2">
            {rest.map((a) => (
              <ArticleCard key={a.id} article={a} variant="list" />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
