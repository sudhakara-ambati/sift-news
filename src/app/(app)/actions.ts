"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { backfillMissingImages, runFetchPipeline } from "@/lib/news/fetch-pipeline";
import { runTagFetch } from "@/lib/news/persist";

type RefreshResult =
  | { ok: true; inserted: number; updated: number; attached?: number }
  | { ok: false; error: string };

export async function refreshArticles(): Promise<RefreshResult> {
  const session = await getServerSession(authOptions);
  if (!session) return { ok: false, error: "Not signed in" };

  try {
    const { counts } = await runFetchPipeline({
      // Manual refresh should prioritise responsiveness.
      // Heavy image enrichment is still handled by cron/backfill actions.
      enableOgHydration: false,
      backfillLimit: 0,
    });
    revalidatePath("/");
    revalidatePath("/tags");
    return { ok: true, inserted: counts.inserted, updated: counts.updated };
  } catch (err) {
    console.error("refreshArticles failed:", err);
    return { ok: false, error: "Fetch failed" };
  }
}

export async function backfillImages(): Promise<
  { ok: true; updated: number } | { ok: false; error: string }
> {
  const session = await getServerSession(authOptions);
  if (!session) return { ok: false, error: "Not signed in" };

  try {
    const updated = await backfillMissingImages();
    revalidatePath("/");
    return { ok: true, updated };
  } catch (err) {
    console.error("backfillImages failed:", err);
    return { ok: false, error: "Backfill failed" };
  }
}

export async function refreshTagArticles(
  tagId: string,
): Promise<RefreshResult> {
  const session = await getServerSession(authOptions);
  if (!session) return { ok: false, error: "Not signed in" };

  try {
    const tag = await prisma.tag.findUnique({
      where: { id: tagId },
      select: { id: true, queryTerms: true },
    });
    if (!tag) return { ok: false, error: "Tag not found" };

    const { inserted, updated, attached } = await runTagFetch(
      tag.id,
      tag.queryTerms,
    );
    revalidatePath("/");
    revalidatePath("/tags");
    return { ok: true, inserted, updated, attached };
  } catch (err) {
    console.error("refreshTagArticles failed:", err);
    return { ok: false, error: "Fetch failed" };
  }
}
