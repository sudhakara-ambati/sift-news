const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const FACEBOOK_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

const TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 512 * 1024;
const CONCURRENCY = 8;

const OG_PATTERNS: RegExp[] = [
  /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
  /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i,
  /<meta[^>]+itemprop=["'](?:image|thumbnailUrl|primaryImageOfPage)["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+itemprop=["'](?:image|thumbnailUrl|primaryImageOfPage)["']/i,
  /<meta[^>]+name=["'](?:thumbnail|image|parsely-image-url|sailthru\.image\.full|sailthru\.image\.thumb)["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+name=["'](?:thumbnail|image|parsely-image-url|sailthru\.image\.full|sailthru\.image\.thumb)["']/i,
  /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i,
];

function extractJsonLdImage(html: string): string | null {
  const scripts = html.match(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  if (!scripts) return null;
  for (const block of scripts) {
    const inner = block.replace(/<script[^>]*>/i, "").replace(/<\/script>/i, "");
    try {
      const parsed = JSON.parse(inner);
      const found = findImageInJsonLd(parsed);
      if (found) return found;
    } catch {
      const match = inner.match(/"image"\s*:\s*"([^"]+)"/);
      if (match?.[1]) return match[1];
    }
  }
  return null;
}

function findImageInJsonLd(node: unknown): string | null {
  if (!node) return null;
  if (typeof node === "string") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findImageInJsonLd(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (typeof obj.image === "string") return obj.image;
    if (Array.isArray(obj.image) && typeof obj.image[0] === "string") return obj.image[0];
    if (obj.image && typeof obj.image === "object") {
      const imgObj = obj.image as Record<string, unknown>;
      if (typeof imgObj.url === "string") return imgObj.url;
      if (Array.isArray(imgObj.url) && typeof imgObj.url[0] === "string") {
        return imgObj.url[0];
      }
    }
    if (typeof obj.thumbnailUrl === "string") return obj.thumbnailUrl;
    for (const v of Object.values(obj)) {
      const found = findImageInJsonLd(v);
      if (found) return found;
    }
  }
  return null;
}

function pickFromSrcset(srcset: string): string | null {
  const candidates = srcset
    .split(",")
    .map((s) => s.trim())
    .map((s) => {
      const [url, descriptor] = s.split(/\s+/, 2);
      const w = descriptor ? parseInt(descriptor.replace(/[^\d]/g, ""), 10) : 0;
      return { url, w: Number.isFinite(w) ? w : 0 };
    })
    .filter((c) => c.url);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.w - a.w);
  return candidates[0].url;
}

function extractPictureImage(html: string): string | null {
  const pictures = html.match(/<picture[\s\S]*?<\/picture>/gi);
  if (!pictures) return null;
  for (const pic of pictures) {
    const sourceMatch = pic.match(/<source[^>]+srcset=["']([^"']+)["']/i);
    if (sourceMatch?.[1]) {
      const picked = pickFromSrcset(sourceMatch[1]);
      if (picked) return picked;
    }
    const imgMatch = pic.match(/<img[^>]+(?:src|data-src|data-lazy-src)=["']([^"']+)["']/i);
    if (imgMatch?.[1]) return imgMatch[1];
  }
  return null;
}

function extractBodyImage(html: string): string | null {
  const imgs = html.match(/<img[^>]+>/gi);
  if (!imgs) return null;
  for (const tag of imgs) {
    const direct =
      tag.match(/\bsrc=["']([^"']+)["']/i)?.[1] ??
      tag.match(/\bdata-src=["']([^"']+)["']/i)?.[1] ??
      tag.match(/\bdata-lazy-src=["']([^"']+)["']/i)?.[1] ??
      tag.match(/\bdata-original=["']([^"']+)["']/i)?.[1];
    const srcsetAttr =
      tag.match(/\bsrcset=["']([^"']+)["']/i)?.[1] ??
      tag.match(/\bdata-srcset=["']([^"']+)["']/i)?.[1];
    const candidate = direct ?? (srcsetAttr ? pickFromSrcset(srcsetAttr) : null);
    if (!candidate) continue;
    if (/\b(logo|icon|avatar|sprite|1x1|pixel|tracker|badge|placeholder|spacer)\b/i.test(candidate))
      continue;
    if (/\.(svg|gif)(\?|$)/i.test(candidate)) continue;
    if (/^data:/i.test(candidate)) continue;
    const width = parseInt(tag.match(/\bwidth=["']?(\d+)/i)?.[1] ?? "0", 10);
    const height = parseInt(tag.match(/\bheight=["']?(\d+)/i)?.[1] ?? "0", 10);
    if ((width > 0 && width < 200) || (height > 0 && height < 120)) continue;
    return candidate;
  }
  return null;
}

function absolutise(url: string, base: string): string | null {
  try {
    return new URL(url, base).toString();
  } catch {
    return null;
  }
}

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
      signal: AbortSignal.timeout(TIMEOUT_MS),
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
  } catch {
    // fall through
  }
  return url;
}

async function fetchHead(url: string, userAgent: string): Promise<{ html: string; base: string } | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": userAgent,
        accept: "text/html,*/*;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok || !res.body) return null;

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < MAX_HTML_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
    const html = new TextDecoder("utf-8", { fatal: false }).decode(
      Buffer.concat(chunks.map((c) => Buffer.from(c))),
    );
    return { html, base: res.url || url };
  } catch {
    return null;
  }
}

function extractFromHtml(html: string, base: string): string | null {
  for (const re of OG_PATTERNS) {
    const match = html.match(re);
    if (match?.[1]) {
      const abs = absolutise(match[1].trim(), base);
      if (abs && /^https?:\/\//i.test(abs)) return abs;
    }
  }

  const jsonLd = extractJsonLdImage(html);
  if (jsonLd) {
    const abs = absolutise(jsonLd.trim(), base);
    if (abs && /^https?:\/\//i.test(abs)) return abs;
  }

  const picture = extractPictureImage(html);
  if (picture) {
    const abs = absolutise(picture.trim(), base);
    if (abs && /^https?:\/\//i.test(abs)) return abs;
  }

  const bodyImg = extractBodyImage(html);
  if (bodyImg) {
    const abs = absolutise(bodyImg.trim(), base);
    if (abs && /^https?:\/\//i.test(abs)) return abs;
  }

  return null;
}

export async function fetchOgImage(articleUrl: string): Promise<string | null> {
  let target: string;
  try {
    new URL(articleUrl);
    target = await resolveGoogleNewsUrl(articleUrl);
  } catch {
    return null;
  }

  const firstPass = await fetchHead(target, BROWSER_UA);
  if (firstPass) {
    const img = extractFromHtml(firstPass.html, firstPass.base);
    if (img) return img;
  }

  const secondPass = await fetchHead(target, FACEBOOK_UA);
  if (secondPass) {
    const img = extractFromHtml(secondPass.html, secondPass.base);
    if (img) return img;
  }

  return null;
}

export async function hydrateImages<T extends { url: string; imageUrl: string | null }>(
  articles: T[],
): Promise<T[]> {
  const missing = articles.filter((a) => !a.imageUrl);
  if (missing.length === 0) return articles;

  const queue = [...missing];
  const imageByUrl = new Map<string, string>();

  async function worker() {
    while (queue.length > 0) {
      const article = queue.shift();
      if (!article) return;
      const img = await fetchOgImage(article.url);
      if (img) imageByUrl.set(article.url, img);
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, missing.length) }, worker);
  await Promise.all(workers);

  return articles.map((a) =>
    a.imageUrl ? a : { ...a, imageUrl: imageByUrl.get(a.url) ?? null },
  );
}
