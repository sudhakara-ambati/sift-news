import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAIProvider } from "@/lib/ai";

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
    });
    if (!res.ok) return null;
    const data = (await res.json()) as WikipediaSummary;
    if (!data.extract || data.extract.trim().length < 20) return null;
    if (data.type === "disambiguation") return null;
    return data.extract.trim();
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
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
    return NextResponse.json({
      term,
      definition: cached.content,
      source: cached.source,
      cached: true,
    });
  }

  const wiki = await fetchWikipedia(term);
  if (wiki) {
    await prisma.definition.create({
      data: { term, content: wiki, source: "wikipedia" },
    });
    return NextResponse.json({
      term,
      definition: wiki,
      source: "wikipedia",
      cached: false,
    });
  }

  try {
    const ai = await getAIProvider().defineTerm({ term });
    await prisma.definition.create({
      data: { term, content: ai, source: "gemini" },
    });
    return NextResponse.json({
      term,
      definition: ai,
      source: "gemini",
      cached: false,
    });
  } catch (err) {
    console.error("defineTerm failed:", err);
    return NextResponse.json(
      { error: "Definition unavailable." },
      { status: 502 },
    );
  }
}
