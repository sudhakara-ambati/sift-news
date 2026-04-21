import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { runFetchPipeline } from "@/lib/news/fetch-pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;

  const url = new URL(request.url);
  if (url.searchParams.get("secret") === secret) return true;

  return false;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runFetchPipeline();
  revalidatePath("/");
  return NextResponse.json({ ok: true, ...result });
}
