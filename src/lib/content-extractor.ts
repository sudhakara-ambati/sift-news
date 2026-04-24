import { extract } from "@extractus/article-extractor";
import { prisma } from "@/lib/db";
import { fetchOgImage } from "@/lib/news/og-image";

const MIN_CONTENT_CHARS = 400;
const MAX_CONTENT_CHARS = 20_000;
const FETCH_TIMEOUT_MS = 6000;

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

// Googlebot UA bypasses soft paywalls on publishers that whitelist search
// crawlers for indexing (NYT, WaPo, Bloomberg, FT, WSJ, The Atlantic, The
// Times, Telegraph, etc). Used as a fallback when the first pass with a
// normal browser UA returns a login wall or too-short body.
const GOOGLEBOT_UA =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const GOOGLE_REFERER = "https://www.google.com/";

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
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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

type ArticleContextInput = {
  id: string;
  content: string | null;
  url: string;
  imageUrl: string | null;
};

type ExtractAttempt = {
  text: string;
  image: string | null;
};

async function tryExtract(
  url: string,
  userAgent: string,
  referer?: string,
): Promise<ExtractAttempt | null> {
  const headers: Record<string, string> = { "user-agent": userAgent };
  if (referer) headers.referer = referer;
  try {
    const data = await extract(
      url,
      { contentLengthThreshold: 200 },
      { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    const rawHtml = data?.content?.trim();
    if (!rawHtml) return null;
    const text = stripHtml(rawHtml).slice(0, MAX_CONTENT_CHARS);
    if (!text) return null;
    return { text, image: data?.image ?? null };
  } catch (err) {
    console.warn(
      `Article extraction attempt failed (${userAgent === GOOGLEBOT_UA ? "googlebot" : "browser"}) for ${url}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export async function getArticleContent(
  articleInput: string | ArticleContextInput,
): Promise<{
  content: string | null;
  source: "cache" | "extracted" | "failed";
}> {
  const article =
    typeof articleInput === "string"
      ? await prisma.article.findUnique({
          where: { id: articleInput },
          select: { id: true, content: true, url: true, imageUrl: true },
        })
      : articleInput;
  if (!article) return { content: null, source: "failed" };

  if (article.content && article.content.length >= MIN_CONTENT_CHARS) {
    return { content: article.content, source: "cache" };
  }

  try {
    const resolvedUrl = await resolveGoogleNewsUrl(article.url);
    if (resolvedUrl.includes("news.google.com")) {
      return { content: null, source: "failed" };
    }

    // First pass: normal browser UA. Works for the vast majority of sites.
    let best = await tryExtract(resolvedUrl, BROWSER_UA);

    // Fallback: if we got nothing or only a short stub (commonly a paywall
    // teaser), retry as Googlebot. Publishers that soft-paywall (NYT, WaPo,
    // Bloomberg, FT, WSJ, Atlantic, Times, Telegraph…) serve the full body
    // to search crawlers, which gives us the same article the user sees.
    if (!best || best.text.length < MIN_CONTENT_CHARS) {
      const googlebot = await tryExtract(resolvedUrl, GOOGLEBOT_UA, GOOGLE_REFERER);
      if (googlebot && (!best || googlebot.text.length > best.text.length)) {
        best = googlebot;
      }
    }

    if (!best || best.text.length < MIN_CONTENT_CHARS) {
      return { content: null, source: "failed" };
    }

    const update: { content: string; imageUrl?: string } = { content: best.text };
    if (!article.imageUrl) {
      const img = best.image || (await fetchOgImage(resolvedUrl));
      if (img) update.imageUrl = img;
    }
    await prisma.article.update({
      where: { id: article.id },
      data: update,
    });
    return { content: best.text, source: "extracted" };
  } catch (err) {
    console.error(`Article extraction failed for ${article.url}:`, err);
    return { content: null, source: "failed" };
  }
}
