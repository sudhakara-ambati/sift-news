import { formatRelativeTime } from "@/lib/time";

type Props = {
  article: {
    id: string;
    title: string;
    url: string;
    source: string;
    publishedAt: Date;
    snippet: string | null;
    imageUrl: string | null;
  };
};

export default function ArticleCard({ article }: Props) {
  return (
    <article className="group rounded-lg border border-white/10 p-4 transition-colors hover:bg-white/[0.03] sm:p-5">
      <div className="flex gap-4">
        <div className="min-w-0 flex-1">
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block"
          >
            <h2 className="text-base font-semibold leading-snug tracking-tight text-white/95 group-hover:text-white sm:text-lg">
              {article.title}
            </h2>
          </a>
          <p className="mt-1 text-xs text-white/50">
            <span className="text-white/70">{article.source}</span>
            <span className="mx-1.5">·</span>
            <span>{formatRelativeTime(article.publishedAt)}</span>
          </p>
          {article.snippet && (
            <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-white/70">
              {article.snippet}
            </p>
          )}
        </div>
        {article.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={article.imageUrl}
            alt=""
            loading="lazy"
            className="hidden h-24 w-24 flex-none rounded object-cover sm:block"
          />
        )}
      </div>
    </article>
  );
}
