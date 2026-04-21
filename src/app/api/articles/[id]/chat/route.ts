import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAIProvider } from "@/lib/ai";
import { AllModelsExhaustedError } from "@/lib/ai/gemini";
import { getArticleContent } from "@/lib/content-extractor";

const MAX_QUESTION_CHARS = 2000;
const MAX_HISTORY_TURNS = 20;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const messages = await prisma.chatMessage.findMany({
    where: { articleId: id },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true, createdAt: true },
  });
  return NextResponse.json({ messages });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const question =
    typeof (body as { question?: unknown })?.question === "string"
      ? ((body as { question: string }).question).trim()
      : "";
  if (!question) {
    return NextResponse.json({ error: "Question is required" }, { status: 400 });
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return NextResponse.json(
      { error: `Question must be under ${MAX_QUESTION_CHARS} characters` },
      { status: 400 },
    );
  }

  const [article, history] = await Promise.all([
    prisma.article.findUnique({
      where: { id },
      select: { id: true, title: true, source: true, url: true, snippet: true },
    }),
    prisma.chatMessage.findMany({
      where: { articleId: id },
      orderBy: { createdAt: "asc" },
      take: MAX_HISTORY_TURNS,
      select: { role: true, content: true },
    }),
  ]);

  if (!article) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  const { content } = await getArticleContent(article.id);

  const provider = getAIProvider();
  const encoder = new TextEncoder();

  let streamResult: { stream: AsyncIterable<string>; model: string };
  try {
    streamResult = await provider.askAboutArticleStream({
      article: {
        title: article.title,
        source: article.source,
        url: article.url,
        content,
        snippet: article.snippet,
      },
      question,
      history: history.map((h) => ({
        role: h.role === "assistant" ? "assistant" : "user",
        content: h.content,
      })),
    });
  } catch (err) {
    console.error("AI chat stream setup failed:", err);
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
      { error: `AI request failed: ${detail.slice(0, 300)}` },
      { status: 502 },
    );
  }

  const modelUsed = streamResult.model;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = "";
      try {
        for await (const chunk of streamResult.stream) {
          full += chunk;
          controller.enqueue(encoder.encode(chunk));
        }

        if (full.trim().length > 0) {
          await prisma.$transaction([
            prisma.chatMessage.create({
              data: { articleId: article.id, role: "user", content: question },
            }),
            prisma.chatMessage.create({
              data: {
                articleId: article.id,
                role: "assistant",
                content: full.trim(),
              },
            }),
          ]);
        }
        controller.close();
      } catch (err) {
        console.error("AI chat stream failed:", err);
        const detail = err instanceof Error ? err.message : String(err);
        controller.enqueue(
          encoder.encode(`\n\n[Error during streaming: ${detail.slice(0, 200)}]`),
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-AI-Model": modelUsed,
    },
  });
}
