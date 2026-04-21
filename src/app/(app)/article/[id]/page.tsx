import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatRelativeTime } from "@/lib/time";
import ChatPanel from "@/components/ChatPanel";
import ArticleSummary from "@/components/ArticleSummary";
import ArticleImage from "@/components/ArticleImage";

export const revalidate = 60;

const MAX_INITIAL_CHAT_MESSAGES = 120;

function parseTerms(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((t): t is string => typeof t === "string")
      : [];
  } catch {
    return [];
  }
}

export default async function ArticleDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const article = await prisma.article.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      url: true,
      source: true,
      publishedAt: true,
      snippet: true,
      summary: true,
      summaryTerms: true,
      summaryModel: true,
      imageUrl: true,
      clusterId: true,
    },
  });

  if (!article) notFound();

  const [clusterMembers, chatMessages] = await Promise.all([
    article.clusterId
      ? prisma.article.findMany({
          where: { clusterId: article.clusterId, NOT: { id: article.id } },
          orderBy: { publishedAt: "desc" },
          select: { id: true, source: true, url: true, publishedAt: true },
        })
      : Promise.resolve([]),
    prisma.chatMessage.findMany({
      where: { articleId: article.id },
      orderBy: { createdAt: "desc" },
      take: MAX_INITIAL_CHAT_MESSAGES,
      select: { id: true, role: true, content: true, createdAt: true },
    }),
  ]);

  const orderedChatMessages = [...chatMessages].reverse();

  return (
    <div className="mx-auto max-w-2xl px-4 py-4 sm:py-6">
      <Link
        href="/"
        className="mb-5 inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-white/50 hover:text-white/80"
      >
        <span aria-hidden>←</span> Feed
      </Link>

      <article>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.15em] text-white/55">
          {article.source}
        </p>
        <h1 className="font-serif text-2xl font-semibold leading-[1.1] tracking-tight text-white sm:text-4xl md:text-[2.75rem]">
          {article.title}
        </h1>
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/50">
          <span>{formatRelativeTime(article.publishedAt)}</span>
          <span aria-hidden>·</span>
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-white/70 underline decoration-white/25 underline-offset-2 hover:text-white hover:decoration-white"
          >
            Read at source ↗
          </a>
        </p>

        {article.imageUrl && (
          <ArticleImage
            src={article.imageUrl}
            loading="lazy"
            className="mt-6 aspect-[16/9] w-full rounded-lg object-cover"
            fallback={null}
          />
        )}

        {article.snippet && (
          <p className="mt-6 border-l-2 border-white/15 pl-4 font-serif text-lg leading-relaxed text-white/85 sm:text-xl">
            {article.snippet}
          </p>
        )}

        <ArticleSummary
          articleId={article.id}
          initialSummary={article.summary}
          initialTerms={parseTerms(article.summaryTerms)}
          initialModel={article.summaryModel}
        />
      </article>

      <ChatPanel
        articleId={article.id}
        initialMessages={orderedChatMessages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt.toISOString(),
        }))}
      />

      {clusterMembers.length > 0 && (
        <section className="mt-8 border-t border-white/10 pt-5">
          <h2 className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.15em] text-white/60 sm:text-xs">
            <span className="h-px flex-none bg-white/25" style={{ width: 24 }} />
            Also covered by
          </h2>
          <ul className="mt-2 divide-y divide-white/5">
            {clusterMembers.map((m) => (
              <li key={m.id}>
                <a
                  href={m.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-baseline justify-between gap-3 py-2 text-sm hover:text-white"
                >
                  <span className="text-white/75">{m.source}</span>
                  <span className="text-xs text-white/40">
                    {formatRelativeTime(m.publishedAt)} ↗
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
