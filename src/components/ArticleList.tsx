import ArticleCard from "@/components/ArticleCard";

type Article = {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: Date;
  snippet: string | null;
  imageUrl: string | null;
};

export default function ArticleList({ articles }: { articles: Article[] }) {
  if (articles.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 p-8 text-center text-sm text-white/60">
        No articles yet. Run the cron job to fetch the feed.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {articles.map((a) => (
        <ArticleCard key={a.id} article={a} />
      ))}
    </div>
  );
}
