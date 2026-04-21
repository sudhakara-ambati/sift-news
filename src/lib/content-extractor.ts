import { extract } from "@extractus/article-extractor";
import { prisma } from "@/lib/db";
import { fetchOgImage } from "@/lib/news/og-image";

const MIN_CONTENT_CHARS = 400;
const MAX_CONTENT_CHARS = 20_000;

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

async function resolveGoogleNewsUrl(url: string): Promise<string> {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith("news.google.com")) return url;
  } catch {
    return url;
  }
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": BROWSER_UA },
    });
    if (res.url && !res.url.includes("news.google.com")) return res.url;
    const html = await res.text();
    const meta = html.match(
      /<meta[^>]+http-equiv=["']?refresh["']?[^>]+url=([^"'>\s]+)/i,
    );
    if (meta?.[1]) return meta[1];
    const canonical = html.match(
      /<link[^>]+rel=["']?canonical["']?[^>]+href=["']([^"']+)["']/i,
    );
    if (canonical?.[1] && !canonical[1].includes("news.google.com")) {
      return canonical[1];
    }
  } catch (err) {
    console.warn("Google News URL resolve failed:", err);
  }
  return url;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function getArticleContent(articleId: string): Promise<{
  content: string | null;
  source: "cache" | "extracted" | "failed";
}> {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { content: true, url: true, imageUrl: true },
  });
  if (!article) return { content: null, source: "failed" };

  if (article.content && article.content.length >= MIN_CONTENT_CHARS) {
    if (!article.imageUrl) {
      const ogImage = await fetchOgImage(article.url);
      if (ogImage) {
        await prisma.article.update({
          where: { id: articleId },
          data: { imageUrl: ogImage },
        });
      }
    }
    return { content: article.content, source: "cache" };
  }

  try {
    const resolvedUrl = await resolveGoogleNewsUrl(article.url);
    if (resolvedUrl.includes("news.google.com")) {
      return { content: null, source: "failed" };
    }
    const data = await extract(
      resolvedUrl,
      { contentLengthThreshold: MIN_CONTENT_CHARS },
      {
        headers: { "user-agent": BROWSER_UA },
        signal: AbortSignal.timeout(6000),
      },
    );
    const rawHtml = data?.content?.trim();
    if (!rawHtml) return { content: null, source: "failed" };

    const text = stripHtml(rawHtml).slice(0, MAX_CONTENT_CHARS);
    if (text.length < MIN_CONTENT_CHARS) {
      return { content: null, source: "failed" };
    }

    const update: { content: string; imageUrl?: string } = { content: text };
    if (!article.imageUrl) {
      const img = data?.image || (await fetchOgImage(resolvedUrl));
      if (img) update.imageUrl = img;
    }
    await prisma.article.update({
      where: { id: articleId },
      data: update,
    });
    return { content: text, source: "extracted" };
  } catch (err) {
    console.error(`Article extraction failed for ${article.url}:`, err);
    return { content: null, source: "failed" };
  }
}
