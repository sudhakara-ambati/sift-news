const NAMED_ENTITIES: Record<string, string> = {
  "&quot;": '"',
  "&apos;": "'",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&nbsp;": " ",
  "&hellip;": "…",
  "&mdash;": "—",
  "&ndash;": "–",
  "&lsquo;": "\u2018",
  "&rsquo;": "\u2019",
  "&ldquo;": "\u201C",
  "&rdquo;": "\u201D",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => {
      try {
        return String.fromCodePoint(Number(n));
      } catch {
        return _;
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      try {
        return String.fromCodePoint(parseInt(n, 16));
      } catch {
        return _;
      }
    })
    .replace(/&[a-zA-Z]+;/g, (m) => NAMED_ENTITIES[m.toLowerCase()] ?? m);
}

export function cleanSnippet(s: string | null | undefined): string | null {
  if (!s) return null;
  const decoded = decodeEntities(s).replace(/\s*\[\+\d+\s*chars?\]\s*$/i, "");
  const collapsed = decoded.replace(/\s+/g, " ").trim();
  return collapsed || null;
}

export function cleanTitle(s: string): string {
  return decodeEntities(s).replace(/\s+/g, " ").trim();
}
