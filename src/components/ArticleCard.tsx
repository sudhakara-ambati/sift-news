import Link from "next/link";
import { formatRelativeTime } from "@/lib/time";
import ArticleImage from "@/components/ArticleImage";

type ArticleData = {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: Date;
  snippet: string | null;
  imageUrl: string | null;
  otherSources?: string[];
};

type Variant = "hero" | "grid" | "list";

type Props = {
  article: ArticleData;
  variant: Variant;
};

function sourcesLabel(others: string[] | undefined): string | null {
  if (!others || others.length === 0) return null;
  const unique = Array.from(new Set(others));
  return `+${unique.length} ${unique.length === 1 ? "source" : "sources"}`;
}

function Meta({
  source,
  publishedAt,
  otherSources,
  size = "xs",
}: {
  source: string;
  publishedAt: Date;
  otherSources?: string[];
  size?: "xs" | "sm";
}) {
  const others = sourcesLabel(otherSources);
  const cls =
    size === "sm"
      ? "text-xs text-white/45 sm:text-sm"
      : "text-[11px] text-white/45";
  return (
    <p className={`flex flex-wrap items-center gap-x-1.5 ${cls}`}>
      <span className="font-medium uppercase tracking-wide text-white/70">
        {source}
      </span>
      <span>·</span>
      <span>{formatRelativeTime(publishedAt)}</span>
      {others && (
        <>
          <span>·</span>
          <span>{others}</span>
        </>
      )}
    </p>
  );
}

function hashHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}

function TextPoster({
  source,
  title,
  aspect = "aspect-[16/10]",
  titleClass,
}: {
  source: string;
  title: string;
  aspect?: string;
  titleClass: string;
}) {
  const hue = hashHue(source);
  const bg = `radial-gradient(120% 90% at 0% 0%, hsl(${hue} 45% 22% / 0.55), transparent 60%), radial-gradient(120% 90% at 100% 100%, hsl(${(hue + 50) % 360} 40% 18% / 0.45), transparent 55%), linear-gradient(145deg, rgba(255,255,255,0.045), rgba(255,255,255,0.01))`;
  return (
    <div
      className={`relative flex ${aspect} w-full flex-col justify-between overflow-hidden rounded-md border border-white/10 p-4 transition-colors group-hover:border-white/20`}
      style={{ backgroundImage: bg }}
      suppressHydrationWarning
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/65">
        {source}
      </span>
      <h3
        className={`line-clamp-5 font-serif font-semibold leading-[1.1] tracking-tight text-white/95 ${titleClass}`}
      >
        {title}
      </h3>
    </div>
  );
}

export default function ArticleCard({ article, variant }: Props) {
  const href = `/article/${article.id}`;

  if (variant === "hero") {
    const hasImage = !!article.imageUrl;
    const heroPoster = (
      <TextPoster
        source={article.source}
        title={article.title}
        aspect="aspect-[16/9]"
        titleClass="text-3xl sm:text-[2.5rem] md:text-[3rem]"
      />
    );
    return (
      <Link href={href} className="group block">
        {hasImage ? (
          <ArticleImage
            key={article.imageUrl}
            src={article.imageUrl!}
            loading="eager"
            className="aspect-[16/9] w-full rounded-lg object-cover opacity-90 transition-opacity group-hover:opacity-100"
            fallback={heroPoster}
          >
            <h2 className="mt-4 font-serif text-2xl font-semibold leading-[1.1] tracking-tight text-white group-hover:text-white sm:text-3xl md:text-4xl">
              {article.title}
            </h2>
            {article.snippet && (
              <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-white/70 sm:text-base">
                {article.snippet}
              </p>
            )}
          </ArticleImage>
        ) : (
          heroPoster
        )}
        <div className="mt-3">
          <Meta
            source={article.source}
            publishedAt={article.publishedAt}
            otherSources={article.otherSources}
            size="sm"
          />
        </div>
      </Link>
    );
  }

  if (variant === "grid") {
    const hasImage = !!article.imageUrl;
    const gridPoster = (
      <TextPoster
        source={article.source}
        title={article.title}
        titleClass="text-lg sm:text-xl"
      />
    );
    return (
      <Link href={href} className="group flex flex-col">
        {hasImage ? (
          <ArticleImage
            key={article.imageUrl}
            src={article.imageUrl!}
            className="aspect-[16/10] w-full rounded-md object-cover opacity-85 transition-opacity group-hover:opacity-100"
            fallback={gridPoster}
          >
            <h3 className="mt-3 line-clamp-3 font-serif text-base font-semibold leading-snug tracking-tight text-white/95 group-hover:text-white sm:text-lg">
              {article.title}
            </h3>
          </ArticleImage>
        ) : (
          gridPoster
        )}

        <div className="mt-3">
          <Meta
            source={article.source}
            publishedAt={article.publishedAt}
            otherSources={article.otherSources}
          />
        </div>
      </Link>
    );
  }

  // list — text-only for consistent alignment across rows (2-col on desktop)
  return (
    <Link
      href={href}
      className="group block border-b border-white/[0.07] py-4 last:border-b-0 sm:py-5"
    >
      <h3 className="line-clamp-2 font-serif text-base font-semibold leading-snug tracking-tight text-white/95 group-hover:text-white sm:text-[17px]">
        {article.title}
      </h3>
      {article.snippet && (
        <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-white/55 sm:text-sm">
          {article.snippet}
        </p>
      )}
      <div className="mt-2.5">
        <Meta
          source={article.source}
          publishedAt={article.publishedAt}
          otherSources={article.otherSources}
        />
      </div>
    </Link>
  );
}
