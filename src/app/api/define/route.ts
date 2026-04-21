import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getAIProvider } from "@/lib/ai";
import { AllModelsExhaustedError } from "@/lib/ai/gemini";

const WIKIPEDIA_TIMEOUT_MS = 5000;
const AI_TIMEOUT_MS = 12000;

const DEFAULT_AI_DEFINITIONS_PER_MINUTE = 24;
const parsedLimit = Number.parseInt(
  process.env.MAX_AI_DEFINITIONS_PER_MINUTE ?? `${DEFAULT_AI_DEFINITIONS_PER_MINUTE}`,
  10,
);
const MAX_AI_DEFINITIONS_PER_MINUTE =
  Number.isFinite(parsedLimit) && parsedLimit > 0
    ? parsedLimit
    : DEFAULT_AI_DEFINITIONS_PER_MINUTE;

let aiWindowStartedAt = Date.now();
let aiDefinitionsInWindow = 0;

type WikipediaSummary = {
  type?: string;
  title?: string;
  extract?: string;
  content_urls?: { desktop?: { page?: string } };
};

async function fetchWikipedia(term: string): Promise<string | null> {
  const slug = encodeURIComponent(term.replace(/\s+/g, "_"));
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${slug}?redirect=true`;
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": "Sift/1.0 (news-reader)",
        accept: "application/json",
      },
      signal: AbortSignal.timeout(WIKIPEDIA_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("application/json")) return null;
    const data = (await res.json()) as WikipediaSummary;
    if (!data.extract || data.extract.trim().length < 20) return null;
    if (data.type === "disambiguation") return null;
    return data.extract.trim();
  } catch {
    return null;
  }
}

function reserveAiDefinitionSlot(): boolean {
  const now = Date.now();
  if (now - aiWindowStartedAt >= 60_000) {
    aiWindowStartedAt = now;
    aiDefinitionsInWindow = 0;
  }
  if (aiDefinitionsInWindow >= MAX_AI_DEFINITIONS_PER_MINUTE) {
    return false;
  }
  aiDefinitionsInWindow += 1;
  return true;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function createOrGetDefinition(params: {
  term: string;
  content: string;
  source: string;
}): Promise<{ definition: string; source: string; cached: boolean }> {
  const { term, content, source } = params;
  try {
    await prisma.definition.create({ data: { term, content, source } });
    return { definition: content, source, cached: false };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const existing = await prisma.definition.findUnique({ where: { term } });
      if (existing) {
        return {
          definition: existing.content,
          source: existing.source,
          cached: true,
        };
      }
    }
    throw err;
  }
}

export async function GET(req: Request) {
  const started = Date.now();
  const url = new URL(req.url);
  const termRaw = url.searchParams.get("term");
  if (!termRaw) {
    return NextResponse.json({ error: "term is required" }, { status: 400 });
  }
  const term = termRaw.trim().slice(0, 120);
  if (!term) {
    return NextResponse.json({ error: "term is required" }, { status: 400 });
  }

  const cached = await prisma.definition.findUnique({ where: { term } });
  if (cached) {
    console.info("defineTerm", {
      term,
      source: cached.source,
      cached: true,
      durationMs: Date.now() - started,
    });
    return NextResponse.json({
      term,
      definition: cached.content,
      source: cached.source,
      cached: true,
    });
  }

  const wiki = await fetchWikipedia(term);
  if (wiki) {
    const persisted = await createOrGetDefinition({
      term,
      content: wiki,
      source: "wikipedia",
    });
    console.info("defineTerm", {
      term,
      source: persisted.source,
      cached: persisted.cached,
      durationMs: Date.now() - started,
    });
    return NextResponse.json({
      term,
      definition: persisted.definition,
      source: persisted.source,
      cached: persisted.cached,
    });
  }

  if (!reserveAiDefinitionSlot()) {
    return NextResponse.json(
      {
        error:
          "Definition service is busy. Please retry in a few seconds.",
      },
      { status: 429 },
    );
  }

  try {
    const ai = await withTimeout(
      getAIProvider().defineTerm({ term }),
      AI_TIMEOUT_MS,
    );
    const persisted = await createOrGetDefinition({
      term,
      content: ai,
      source: "gemini",
    });
    console.info("defineTerm", {
      term,
      source: persisted.source,
      cached: persisted.cached,
      durationMs: Date.now() - started,
    });
    return NextResponse.json({
      term,
      definition: persisted.definition,
      source: persisted.source,
      cached: persisted.cached,
    });
  } catch (err) {
    if (err instanceof AllModelsExhaustedError) {
      return NextResponse.json(
        {
          error:
            "AI definition quota is currently exhausted. Please try again later.",
        },
        { status: 429 },
      );
    }
    console.error("defineTerm failed:", err);
    return NextResponse.json(
      { error: "Definition unavailable." },
      { status: 502 },
    );
  }
}
