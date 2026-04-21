"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { runTagFetch } from "@/lib/news/persist";
import { getAIProvider } from "@/lib/ai";

type ActionResult = { ok: true } | { ok: false; error: string };
type CreateTagResult = { ok: true; id: string } | { ok: false; error: string };

function normaliseName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

function validate(name: string, queryTerms: string): string | null {
  if (!name) return "Name is required.";
  if (name.length > 60) return "Name must be 60 characters or fewer.";
  if (!queryTerms.trim()) return "Query terms are required.";
  if (queryTerms.length > 500) return "Query terms must be 500 characters or fewer.";
  return null;
}

export async function createTag(formData: FormData): Promise<CreateTagResult> {
  const name = normaliseName(String(formData.get("name") ?? ""));
  const queryTerms = String(formData.get("queryTerms") ?? "").trim();

  const invalid = validate(name, queryTerms);
  if (invalid) return { ok: false, error: invalid };

  const existing = await prisma.tag.findUnique({ where: { name } });
  if (existing) return { ok: false, error: "A tag with that name already exists." };

  const created = await prisma.tag.create({
    data: { name, queryTerms },
    select: { id: true },
  });
  revalidatePath("/tags");
  revalidatePath("/");
  return { ok: true, id: created.id };
}

export async function updateTag(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const name = normaliseName(String(formData.get("name") ?? ""));
  const queryTerms = String(formData.get("queryTerms") ?? "").trim();

  const invalid = validate(name, queryTerms);
  if (invalid) return { ok: false, error: invalid };

  const clash = await prisma.tag.findFirst({
    where: { name, NOT: { id } },
    select: { id: true },
  });
  if (clash) return { ok: false, error: "A tag with that name already exists." };

  const before = await prisma.tag.findUnique({
    where: { id },
    select: { queryTerms: true },
  });
  await prisma.tag.update({ where: { id }, data: { name, queryTerms } });
  void before;
  revalidatePath("/tags");
  revalidatePath("/");
  return { ok: true };
}

type QueryResult =
  | { ok: true; queryTerms: string }
  | { ok: false; error: string };

export async function generateQueryTerms(name: string): Promise<QueryResult> {
  const trimmed = normaliseName(name);
  if (!trimmed) return { ok: false, error: "Enter a tag name first." };
  try {
    const provider = getAIProvider();
    const queryTerms = await provider.generateTagQuery({ name: trimmed });
    if (!queryTerms) return { ok: false, error: "AI returned an empty query." };
    return { ok: true, queryTerms };
  } catch (err) {
    console.error("generateQueryTerms failed:", err);
    return {
      ok: false,
      error: "AI request failed. Check GEMINI_API_KEY and try again.",
    };
  }
}

export async function deleteTag(id: string): Promise<ActionResult> {
  await prisma.tag.delete({ where: { id } });
  revalidatePath("/tags");
  revalidatePath("/");
  return { ok: true };
}

type PurgeResult =
  | { ok: true; removed: number; fetched: number; inserted: number }
  | { ok: false; error: string };

export async function purgeTagArticles(id: string): Promise<PurgeResult> {
  const tag = await prisma.tag.findUnique({
    where: { id },
    select: { queryTerms: true },
  });
  if (!tag) return { ok: false, error: "Tag not found." };

  // Delete articles that are tagged ONLY with this tag — they only exist
  // because of this tag's query. Articles with other tags (or untagged
  // top-headlines articles) are left alone.
  const onlyThisTag = await prisma.article.findMany({
    where: { tags: { some: { tagId: id }, every: { tagId: id } } },
    select: { id: true },
  });
  if (onlyThisTag.length > 0) {
    await prisma.article.deleteMany({
      where: { id: { in: onlyThisTag.map((a) => a.id) } },
    });
  }
  const removed = await prisma.articleTag.deleteMany({ where: { tagId: id } });

  try {
    const res = await runTagFetch(id, tag.queryTerms);
    revalidatePath("/tags");
    revalidatePath("/");
    return {
      ok: true,
      removed: removed.count,
      fetched: res.fetched,
      inserted: res.inserted,
    };
  } catch (err) {
    console.error("Purge refetch failed:", err);
    return { ok: false, error: "Refetch after purge failed. Check logs." };
  }
}
