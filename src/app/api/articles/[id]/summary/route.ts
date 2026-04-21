import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAIProvider } from "@/lib/ai";
import { AllModelsExhaustedError } from "@/lib/ai/gemini";
import { getArticleContent } from "@/lib/content-extractor";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const article = await prisma.article.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      source: true,
      url: true,
      content: true,
      imageUrl: true,
      snippet: true,
      summary: true,
      summaryTerms: true,
      summaryModel: true,
    },
  });
  if (!article) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  if (article.summary) {
    return NextResponse.json({
      summary: article.summary,
      terms: parseTerms(article.summaryTerms),
      cached: true,
      model: article.summaryModel,
    });
  }

  const { content } = await getArticleContent({
    id: article.id,
    url: article.url,
    content: article.content,
    imageUrl: article.imageUrl,
  });

  const provider = getAIProvider();
  let result: { summary: string; terms: string[]; model?: string };
  try {
    result = await provider.summarizeArticle({
      article: {
        title: article.title,
        source: article.source,
        url: article.url,
        content,
        snippet: article.snippet,
      },
    });
  } catch (err) {
    console.error("Summary generation failed:", err);
    if (err instanceof AllModelsExhaustedError) {
      return NextResponse.json(
        {
          error:
            "Gemini free-tier quota exhausted across all fallback models. Try again after midnight Pacific (~8am UK), or add billing to lift the cap.",
        },
        { status: 429 },
      );
    }
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: `AI request failed: ${detail.slice(0, 300)}`,
      },
      { status: 502 },
    );
  }

  await prisma.article.update({
    where: { id: article.id },
    data: {
      summary: result.summary,
      summaryTerms: JSON.stringify(result.terms),
      summaryModel: result.model ?? null,
    },
  });

  return NextResponse.json({
    summary: result.summary,
    terms: result.terms,
    cached: false,
    model: result.model ?? null,
  });
}

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
