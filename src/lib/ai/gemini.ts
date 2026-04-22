import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type {
  AIProvider,
  ArticleContext,
  ArticleSummaryResult,
  ChatTurn,
} from ".";

// Cascade order: try Gemini first (best quality, supports tools/schema), then
// fall back to Gemma which has massively higher daily quotas (~14.4K RPD vs
// ~20 RPD) but doesn't support tools, system instructions, or response schema.
//
// 2.0 flash family and 2.5 Pro show 0/0 on many free-tier accounts in 2026,
// so they're intentionally excluded — the exhaustion cache would waste one
// call on each of them otherwise.
const DEFAULT_MODELS = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-3-flash-lite-latest",
  "gemini-3-flash-latest",
  "gemma-3-27b-it",
  "gemma-3-12b-it",
  "gemma-3-4b-it",
];
const TAG_QUERY_DEFAULT_MODELS = [
  "gemini-2.5-flash-lite",
  "gemini-3-flash-lite-latest",
  "gemma-3-4b-it",
];

const DEFAULT_CHAT_HISTORY_CHAR_BUDGET = 6000;
const parsedChatHistoryBudget = Number.parseInt(
  process.env.AI_CHAT_HISTORY_CHAR_BUDGET ?? `${DEFAULT_CHAT_HISTORY_CHAR_BUDGET}`,
  10,
);
const CHAT_HISTORY_CHAR_BUDGET =
  Number.isFinite(parsedChatHistoryBudget) && parsedChatHistoryBudget > 0
    ? parsedChatHistoryBudget
    : DEFAULT_CHAT_HISTORY_CHAR_BUDGET;

function isGemma(modelName: string): boolean {
  return modelName.startsWith("gemma-");
}

function getModels(): string[] {
  const primary = process.env.GEMINI_MODEL?.trim();
  const fallbacks = process.env.GEMINI_FALLBACK_MODELS
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (primary && fallbacks?.length) return [primary, ...fallbacks];
  if (primary) return [primary, ...DEFAULT_MODELS.filter((m) => m !== primary)];
  return DEFAULT_MODELS;
}

function getTagQueryModels(): string[] {
  const override = process.env.GEMINI_TAG_QUERY_MODELS
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (override && override.length > 0) return override;

  const all = getModels();
  const selected = TAG_QUERY_DEFAULT_MODELS.filter((m) => all.includes(m));
  return selected.length > 0 ? selected : all.slice(0, 3);
}

function getClient(): GoogleGenerativeAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  return new GoogleGenerativeAI(key);
}

function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b(429|quota|RESOURCE_EXHAUSTED|Too Many Requests)\b/i.test(msg);
}

// True if the error indicates the daily quota is gone (not just per-minute).
function isDailyQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /PerDay/i.test(msg);
}

function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b(503|502|500|504|UNAVAILABLE|overloaded|high demand)\b/i.test(msg);
}

// "Model not found" or "not supported" — same cascade treatment as a
// permanently-exhausted model: don't burn more cycles on it this process.
function isModelUnavailable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /(404 Not Found|is not found for API version|is not supported for generateContent|not supported for the v1)/i.test(
    msg,
  );
}

// Cache of models that are daily-quota exhausted for this process run.
// Entries expire after EXHAUSTION_TTL_MS so a restart isn't required once
// the daily quota resets at midnight Pacific.
const EXHAUSTION_TTL_MS = 60 * 60 * 1000; // 1 hour
const exhaustedModels = new Map<string, number>();

function markExhausted(modelName: string) {
  exhaustedModels.set(modelName, Date.now() + EXHAUSTION_TTL_MS);
}

function isExhausted(modelName: string): boolean {
  const until = exhaustedModels.get(modelName);
  if (!until) return false;
  if (Date.now() > until) {
    exhaustedModels.delete(modelName);
    return false;
  }
  return true;
}

export class AllModelsExhaustedError extends Error {
  constructor() {
    super("All Gemini free-tier models are rate-limited.");
    this.name = "AllModelsExhaustedError";
  }
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientError(err) || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr;
}

const RPM_BACKOFF_MS = 15_000;

type ModelResult<T> = { value: T; model: string };

async function tryModels<T>(
  models: string[],
  fn: (modelName: string) => Promise<T>,
): Promise<{ result?: ModelResult<T>; lastErr?: unknown; allQuota: boolean; anyRpmOnly: boolean }> {
  let lastErr: unknown;
  let allQuota = true;
  let anyRpmOnly = false;
  for (let i = 0; i < models.length; i++) {
    const modelName = models[i];
    try {
      const value = await fn(modelName);
      return { result: { value, model: modelName }, allQuota: false, anyRpmOnly: false };
    } catch (err) {
      lastErr = err;
      const quota = isQuotaError(err);
      if (!quota) allQuota = false;
      if (quota && isDailyQuotaError(err)) {
        markExhausted(modelName);
      } else if (quota) {
        anyRpmOnly = true;
      } else if (isModelUnavailable(err)) {
        markExhausted(modelName);
      }
      if (i < models.length - 1) {
        const reason = quota ? "hit quota" : "failed";
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `Gemini model ${modelName} ${reason} (${msg.slice(0, 200)}), falling back to ${models[i + 1]}`,
        );
      }
    }
  }
  return { lastErr, allQuota, anyRpmOnly };
}

async function withModelFallback<T>(
  fn: (modelName: string) => Promise<T>,
): Promise<ModelResult<T>> {
  const models = getModels();
  const live = models.filter((m) => !isExhausted(m));
  if (live.length === 0) throw new AllModelsExhaustedError();

  const first = await tryModels(live, fn);
  if (first.result) return first.result;

  // If all failures were per-minute (not per-day), the RPM counter will have
  // cooled off after a short wait — retry the still-live models once.
  if (first.allQuota && first.anyRpmOnly) {
    console.warn(
      `All models hit per-minute quota; waiting ${RPM_BACKOFF_MS}ms before retrying.`,
    );
    await new Promise((r) => setTimeout(r, RPM_BACKOFF_MS));
    const stillLive = getModels().filter((m) => !isExhausted(m));
    if (stillLive.length > 0) {
      const second = await tryModels(stillLive, fn);
      if (second.result) return second.result;
      if (second.allQuota) throw new AllModelsExhaustedError();
      if (second.lastErr !== undefined) throw second.lastErr;
    }
  }

  if (first.allQuota) throw new AllModelsExhaustedError();
  throw first.lastErr;
}

// Tag-query generation is user-triggered and latency-sensitive. We skip the
// long per-minute quota backoff loop here so UI feedback is faster.
async function withTagQueryModelFallback<T>(
  fn: (modelName: string) => Promise<T>,
): Promise<ModelResult<T>> {
  const models = getTagQueryModels();
  const live = models.filter((m) => !isExhausted(m));
  if (live.length === 0) throw new AllModelsExhaustedError();

  const first = await tryModels(live, fn);
  if (first.result) return first.result;
  if (first.allQuota) throw new AllModelsExhaustedError();
  throw first.lastErr;
}

function buildSystemPrompt(article: ArticleContext): string {
  const body =
    article.content && article.content.trim().length > 0
      ? article.content
      : article.snippet
        ? `Short snippet only (full article body unavailable): ${article.snippet}`
        : "No article body was available.";

  return [
    "You are a helpful assistant answering questions about a news article the user is reading.",
    "You have access to Google Search as a tool. USE IT whenever the user asks about specifics you're not certain about — recent events, dates, casualty numbers, names of perpetrators, claims of responsibility, investigations, anything where fresh or factual detail matters. Do NOT guess with 'would likely' or 'typically' when you could search.",
    "Use the article below as your primary source when the user asks about what's in it. For follow-ups about things the article only mentions in passing — other events, people, places, related topics — search the web and answer with real details, not speculation.",
    "When you use search results, briefly say so ('According to recent reporting…') and cite outlets by name where natural. When drawing from general world knowledge, say so too ('Based on background knowledge:').",
    "Never refuse because the article doesn't cover something — that's when searching is most useful.",
    "Keep replies concise (2-5 short paragraphs max) and use British English.",
    "",
    `Article title: ${article.title}`,
    `Source: ${article.source}`,
    `URL: ${article.url}`,
    "",
    "Article content:",
    body,
  ].join("\n");
}

function buildChatModel(
  modelName: string,
  article: ArticleContext,
  client: GoogleGenerativeAI,
) {
  if (isGemma(modelName)) {
    return { model: client.getGenerativeModel({ model: modelName }), needsInlineSystem: true };
  }
  return {
    model: client.getGenerativeModel({
      model: modelName,
      systemInstruction: buildSystemPrompt(article),
      // @ts-expect-error — googleSearch tool is supported by Gemini 2.x but not in this SDK version's types
      tools: [{ googleSearch: {} }],
    }),
    needsInlineSystem: false,
  };
}

function buildChatHistory(
  history: ChatTurn[],
  article: ArticleContext,
  needsInlineSystem: boolean,
) {
  const boundedHistory = (() => {
    if (history.length <= 1) return history;
    const kept: ChatTurn[] = [];
    let used = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      const turn = history[i];
      const cost = turn.content.length + 32;
      if (used + cost > CHAT_HISTORY_CHAR_BUDGET && kept.length >= 2) break;
      kept.push(turn);
      used += cost;
    }
    return kept.reverse();
  })();

  const mapped = boundedHistory.map((t) => ({
    role: t.role === "assistant" ? "model" : "user",
    parts: [{ text: t.content }],
  }));
  if (!needsInlineSystem || mapped.length > 0) return mapped;
  // For Gemma's first turn, seed the context with a synthetic user/model pair
  // so the article context is carried forward. Subsequent turns use real history.
  return [
    { role: "user", parts: [{ text: buildSystemPrompt(article) }] },
    { role: "model", parts: [{ text: "Understood — I'll answer based on that article and my general knowledge." }] },
  ];
}

function sanitizeQuery(raw: string): string {
  let q = raw
    .trim()
    .replace(/^```[a-z]*\n?/i, "")
    .replace(/\n?```$/, "")
    .trim();
  // Drop "Query:" / "Improved query:" style prefixes if the model echoed them.
  q = q.replace(/^(improved\s+query|final\s+query|query)\s*:\s*/i, "").trim();
  // Strip surrounding quotes if the whole thing was wrapped.
  if ((q.startsWith('"') && q.endsWith('"')) || (q.startsWith("'") && q.endsWith("'"))) {
    const inner = q.slice(1, -1);
    if (!inner.includes('"') && !inner.includes("'")) q = inner;
  }
  // Collapse any stray newlines the model may have left in.
  q = q.replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").trim();
  if (q.length > 480) q = q.slice(0, 480).replace(/\s+\S*$/, "").trim();
  return q;
}

function fallbackQueryFromTag(name: string): string {
  const cleaned = name.trim().replace(/\s+/g, " ");
  if (!cleaned) return "";
  return /\s/.test(cleaned) ? `"${cleaned.replace(/"/g, '\\"')}"` : cleaned;
}

function quoteIfNeeded(term: string): string {
  return /\s/.test(term) ? `"${term.replace(/"/g, '\\"')}"` : term;
}

function buildOrQueryFromCommaList(line: string): string | null {
  const parts = line
    .split(",")
    .map((p) => p.trim().replace(/^[`"']+|[`"'.]+$/g, ""))
    .filter(Boolean);

  if (parts.length < 3 || parts.length > 20) return null;
  if (parts.some((p) => p.length < 2 || p.length > 60)) return null;
  // Avoid converting normal prose sentences into OR lists.
  if (parts.some((p) => /^(the|and|but|or|if|when|what)\b/i.test(p))) return null;

  return parts.map(quoteIfNeeded).join(" OR ");
}

function tryParseQueryJson(raw: string): string | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const candidates = [cleaned];
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(cleaned.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as
        | { query?: unknown; queryTerms?: unknown }
        | null;
      if (!parsed || typeof parsed !== "object") continue;
      if (typeof parsed.query === "string" && parsed.query.trim()) {
        return parsed.query.trim();
      }
      if (typeof parsed.queryTerms === "string" && parsed.queryTerms.trim()) {
        return parsed.queryTerms.trim();
      }
    } catch {
      // Not JSON; continue.
    }
  }
  return null;
}

function isLikelyQuery(text: string): boolean {
  if (!text) return false;
  if (/[\r\n]/.test(text)) return false;
  if (text.length < 2 || text.length > 500) return false;
  if (
    /(the user wants|what is this tag|proper nouns|which distinctive|output only|newsapi|think through)/i.test(
      text,
    )
  ) {
    return false;
  }
  const hasBoolean = /\b(?:AND|OR|NOT)\b/.test(text);
  const hasStructure = /[()"]/.test(text);
  const tokenCount = text.split(/\s+/).length;
  if (hasBoolean || hasStructure) return true;
  // Allow concise single-topic fallbacks like "Gaza" / "OpenAI".
  return tokenCount <= 4 && !/[.!?]/.test(text);
}

function normaliseBooleanOperators(text: string): string {
  return text.replace(/\b(and|or|not)\b/gi, (m) => m.toUpperCase());
}

function estimateTermCount(query: string): number {
  return query
    .split(/\b(?:AND|OR)\b/)
    .map((s) => s.replace(/[()]/g, " ").trim())
    .filter(Boolean).length;
}

function queryQualityScore(query: string, tagName: string): number {
  const q = query.trim();
  const termCount = estimateTermCount(q);
  const andCount = (q.match(/\bAND\b/g) ?? []).length;
  const orCount = (q.match(/\bOR\b/g) ?? []).length;
  const quotedCount = (q.match(/"/g) ?? []).length / 2;

  let score = 0;
  score += termCount * 5;
  score += andCount * 6;
  score += orCount * 2;
  score += Math.min(quotedCount, 8) * 1.5;
  score += Math.min(q.length, 420) / 50;

  // Strong penalty for ultra-short queries that tend to be low-signal.
  if (termCount <= 2) score -= 20;

  // Compound topics should usually have at least one AND group.
  if (
    /\b(war|conflict|crisis|sanctions|ceasefire|regulation|policy)\b/i.test(tagName) &&
    andCount === 0
  ) {
    score -= 8;
  }

  return score;
}

function pickBestQuery(candidates: string[], tagName: string): string | null {
  const unique = Array.from(
    new Set(
      candidates
        .map((c) => ensureGroupedOrQuery(normaliseBooleanOperators(sanitizeQuery(c))))
        .filter(Boolean),
    ),
  );
  if (unique.length === 0) return null;

  const valid = unique.filter(isLikelyQuery);
  if (valid.length === 0) return null;

  return [...valid].sort(
    (a, b) => queryQualityScore(b, tagName) - queryQualityScore(a, tagName),
  )[0];
}

function ensureGroupedOrQuery(text: string): string {
  const q = text.trim();
  const hasOr = /\bOR\b/.test(q);
  const hasAnd = /\bAND\b/.test(q);
  if (hasOr && !hasAnd && !q.startsWith("(") && !q.endsWith(")")) {
    return `(${q})`;
  }
  return q;
}

function extractBestQuery(raw: string, tagName: string): string {
  const direct = sanitizeQuery(raw);
  const jsonQuery = tryParseQueryJson(raw);
  const lineCandidates = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const stripped = line
        .replace(/^\s*(?:[-*]|\d+[.)])\s*/, "")
        .replace(/^\s*(?:query|improved query|final query)\s*:\s*/i, "")
        .trim();
      const fromArrow = stripped.includes("→")
        ? stripped.split("→").slice(1).join("→").trim()
        : "";
      return [stripped, fromArrow].filter(Boolean);
    });

  const candidates = [
    ...(jsonQuery ? [jsonQuery] : []),
    direct,
    ...lineCandidates,
  ];

  const expanded = [...candidates];
  for (const candidate of candidates) {
    const orQuery = buildOrQueryFromCommaList(candidate);
    if (orQuery) expanded.push(orQuery);
  }

  const best = pickBestQuery(expanded, tagName);
  if (best) {
    return best;
  }

  return ensureGroupedOrQuery(
    normaliseBooleanOperators(fallbackQueryFromTag(tagName)),
  );
}

const QUERY_GUIDE = [
  "NewsAPI `/everything` query behaviour:",
  "- Matches across title + description + content (full-text).",
  "- No stemming/lemmatisation — `hiring` does NOT match `hired` or `hires`. Include common inflections explicitly if needed.",
  "- Phrases with spaces MUST be double-quoted: `\"signing bonus\"`. Single tokens don't need quotes.",
  "- Supports AND, OR, NOT, parentheses. AND is implicit between groups; be explicit for clarity.",
  "- Boolean operators MUST be uppercase.",
  "- Everything is case-insensitive.",
  "",
  "Noise rules (violating these is the #1 cause of bad feeds):",
  "- Single generic tokens like `AI`, `ML`, `tech`, `research`, `data`, `company`, `startup`, `model`, `platform` match massive noise — NEVER use on their own.",
  "- Broad academic umbrellas (`\"artificial intelligence\"`, `\"machine learning\"`, `\"deep learning\"`, `\"data science\"`, `\"computer vision\"`, `\"natural language processing\"`) pull chemistry / biology / materials / medical papers and every vendor press release. Do NOT rely on them — use org / product / person names instead, OR put them in an AND-group with a narrower facet.",
  "- Process words (`hiring`, `funding`, `research`, `launch`) as standalone terms flood with irrelevant business news. Only use inside AND-groups.",
  "- AMBIGUOUS PRODUCT NAMES — product names that collide with common words, common names, zodiac signs, existing brands, or historical figures. These must be disambiguated by quoting them in a longer phrase or by pairing them AND-style with a parent brand. Examples (not exhaustive):",
  "    - `Claude` → common French first name. Use `\"Claude AI\"` / `\"Claude Sonnet\"` / `\"Claude Opus\"`, or rely on `Anthropic` alone.",
  "    - `Gemini` → zodiac sign + NASA programme + trading platform. Use `\"Google Gemini\"` / `\"Gemini Pro\"` / `\"Gemini 2.5\"`.",
  "    - `Grok` → also an English verb meaning 'understand'. Use `\"Grok AI\"` or rely on `xAI`.",
  "    - `Meta` alone → the preposition meta. Use `\"Meta AI\"` or `Meta AND (AI OR Llama)`.",
  "    - `Apple` / `Orange` / `Amazon` on their own → fruit / river. Pair with product terms.",
  "  If you include a product name, ASK YOURSELF: could this word plausibly appear in an unrelated article? If yes, disambiguate.",
  "",
  "Structure:",
  "- SINGLE narrow topic (e.g. \"UK politics\", \"OpenAI\", \"Climate\") → one OR-list of the 6–12 most distinctive proper nouns, products, places, and multi-word phrases.",
  "- MULTI-FACET topic (e.g. \"Quant firms hiring AI researchers\", \"AI regulation in the EU\") → `(facet-A terms) AND (facet-B terms)`. Parenthesised OR-groups are CRITICAL here — a flat OR will return 95% noise.",
  "- Keep total length under 400 characters.",
].join("\n");

async function draftTagQuery(name: string): Promise<string> {
  const prompt = [
    "You are a senior news-query engineer building a NewsAPI `/everything` query for a topic tag.",
    "Your output will be used to fetch stories for a personal news feed. High-signal queries return ~50 relevant articles/day; bad queries return spam, marketing, and chemistry papers.",
    "",
    QUERY_GUIDE,
    "",
    "Hard constraints:",
    "- Output a production-ready query, not a minimal placeholder.",
    "- For single-topic tags, include at least 6 distinctive terms.",
    "- For war/conflict tags, prefer two grouped facets joined by AND.",
    "",
    "Think through this internally before answering (do NOT output the reasoning):",
    "1. What is this tag really about? One topic, or multiple AND'd facets?",
    "2. Which proper nouns — people, orgs, products, places, treaties, laws, events — are central in 2026? List ~10 mentally.",
    "3. Which distinctive multi-word phrases does actual coverage use (e.g. `\"ceasefire agreement\"`, `\"model release\"`, `\"safety evaluation\"`)?",
    "4. Which generic / academic words would flood the feed with noise if included bare? Avoid or AND-constrain them.",
    "5. If multi-facet: structure as `(A OR …) AND (B OR …)`.",
    "",
    "Examples of strong queries:",
    '  Tag "AI" →',
    '    OpenAI OR Anthropic OR "Google DeepMind" OR DeepMind OR "Hugging Face" OR "Mistral AI" OR ChatGPT OR "Claude AI" OR "Claude Sonnet" OR "Google Gemini" OR "GPT-5" OR "GPT-4" OR "Llama 3" OR "Meta AI" OR xAI OR "Scale AI"',
    '  Tag "UK politics" →',
    '    "UK politics" OR "British politics" OR Westminster OR Starmer OR Sunak OR Farage OR "Downing Street" OR "House of Commons" OR "Labour Party" OR "Conservative Party" OR "Reform UK"',
    '  Tag "Israel-Iran war" →',
    '    Israel AND (Iran OR Tehran OR IRGC OR Hezbollah OR "Axis of Resistance" OR Khamenei OR "nuclear programme")',
    '  Tag "Quant firms poaching AI researchers" →',
    '    ("Jane Street" OR Citadel OR "Two Sigma" OR "Renaissance Technologies" OR "Jump Trading" OR "hedge fund" OR "quant firm" OR "quantitative trading") AND ("AI researcher" OR "ML researcher" OR "AI talent" OR poaching OR "signing bonus" OR compensation OR hired)',
    '  Tag "EU AI regulation" →',
    '    ("European Union" OR EU OR Brussels OR "European Commission" OR "European Parliament") AND ("AI Act" OR "AI regulation" OR "artificial intelligence" OR OpenAI OR Anthropic OR DeepMind)',
    "",
    "Output ONLY the query string — no surrounding quotes, no markdown, no explanation, no leading `Query:`.",
    "",
    '  Tag "Gaza" â†’',
    '    (Gaza OR "Gaza Strip" OR Rafah OR "Khan Younis" OR "Deir al-Balah" OR UNRWA) AND (Israel OR IDF OR Hamas OR ceasefire OR hostage OR humanitarian)',
    '  Tag "Israel-Iran war" (richer variant) â†’',
    '    (Israel OR Jerusalem OR IDF) AND (Iran OR Tehran OR IRGC OR "Islamic Revolutionary Guard Corps" OR Khamenei OR "Supreme Leader" OR Hezbollah OR "Axis of Resistance" OR "nuclear programme")',
    `Tag: ${name}`,
    "Query:",
  ].join("\n");

  const { value: raw } = await withTagQueryModelFallback(async (modelName) => {
    const client = getClient();
    const model = client.getGenerativeModel({ model: modelName });
    const result = await withRetry(() => model.generateContent(prompt), 2);
    return result.response.text().trim();
  });
  return extractBestQuery(raw, name);
}

async function refineTagQuery(name: string, draft: string): Promise<string> {
  const prompt = [
    "You are a senior editor for news-search queries. A junior engineer produced the draft query below for the given tag. Your job: output a SUPERIOR replacement. Even if the draft is good, improve it.",
    "",
    QUERY_GUIDE,
    "",
    "Review checklist — go through every item:",
    "1. Noise words: Does the draft contain bare `AI`, `ML`, `tech`, `research`, `data`, `model`, or similar generic singletons that will flood the feed? Remove or tighten.",
    "2. Academic umbrellas bare: `\"artificial intelligence\"` / `\"machine learning\"` / `\"deep learning\"` sitting alone in an OR list → replace with org/product names or move into an AND-group with a narrower facet.",
    "3. Ambiguous product names — THIS IS THE #1 REGRESSION: Scan for bare product names that collide with common words, common first names, zodiac signs, or existing brands. ALWAYS fix these:",
    "    - bare `Claude` → `\"Claude AI\"` / `\"Claude Sonnet\"` / `\"Claude Opus\"`, or remove (Anthropic catches it).",
    "    - bare `Gemini` → `\"Google Gemini\"` / `\"Gemini Pro\"`.",
    "    - bare `Grok` → `\"Grok AI\"` (verb collision).",
    "    - bare `Meta` → `\"Meta AI\"` / `Meta AND (AI OR Llama)`.",
    "    - bare `Apple` / `Orange` / `Amazon` (as product-company) → pair with product/people names.",
    "    - any `X AI` style product with unquoted `AI` at the end → always quote the whole phrase (`\"Perplexity AI\"`, not `Perplexity AI`).",
    "4. Missing critical entities: For this tag in 2026, which major companies, products, people, places, or events MUST be caught that are absent? Add up to ~3 of the most important.",
    "5. Multi-facet structure: If the tag expresses a combined concept (X doing Y, X in Y), is it `(A) AND (B)`? If not, restructure.",
    "6. Dead / stale entities: Old projects, renamed orgs, fringe figures that pull irrelevant results → remove.",
    "7. Boolean hygiene: AND/OR/NOT uppercase? Balanced parentheses? Phrases with spaces double-quoted?",
    "8. Length: ≤ 400 chars. Cut the least-distinctive terms first if over.",
    "",
    "If the draft is already excellent, you may output it unchanged. But usually you'll find at least one improvement.",
    "",
    "Output ONLY the final improved query — no diff, no commentary, no leading `Improved query:`, no surrounding quotes.",
    "",
    `Tag: ${name}`,
    `Draft: ${draft}`,
    "",
    "Improved query:",
  ].join("\n");

  const { value: raw } = await withTagQueryModelFallback(async (modelName) => {
    const client = getClient();
    const model = client.getGenerativeModel({ model: modelName });
    const result = await withRetry(() => model.generateContent(prompt), 2);
    return result.response.text().trim();
  });
  return extractBestQuery(raw, name);
}

export class GeminiProvider implements AIProvider {
  async askAboutArticle({
    article,
    question,
    history,
  }: {
    article: ArticleContext;
    question: string;
    history: ChatTurn[];
  }): Promise<string> {
    const { value } = await withModelFallback(async (modelName) => {
      const client = getClient();
      const { model, needsInlineSystem } = buildChatModel(modelName, article, client);
      const chat = model.startChat({
        history: buildChatHistory(history, article, needsInlineSystem),
      });
      const result = await withRetry(() => chat.sendMessage(question));
      return result.response.text().trim();
    });
    return value;
  }

  async askAboutArticleStream({
    article,
    question,
    history,
  }: {
    article: ArticleContext;
    question: string;
    history: ChatTurn[];
  }): Promise<{ stream: AsyncIterable<string>; model: string }> {
    const { value: streamResult, model: modelUsed } = await withModelFallback(
      async (modelName) => {
        const client = getClient();
        const { model, needsInlineSystem } = buildChatModel(modelName, article, client);
        const chat = model.startChat({
          history: buildChatHistory(history, article, needsInlineSystem),
        });
        return await withRetry(() => chat.sendMessageStream(question));
      },
    );

    const iter = (async function* () {
      for await (const chunk of streamResult.stream) {
        const text = chunk.text();
        if (text) yield text;
      }
    })();

    return { stream: iter, model: modelUsed };
  }

  async summarizeArticle({
    article,
  }: {
    article: ArticleContext;
  }): Promise<ArticleSummaryResult> {
    const hasContent =
      !!article.content && article.content.trim().length >= 200;
    const body = hasContent
      ? article.content!
      : article.snippet && article.snippet.trim().length > 0
        ? `Short snippet only (full body unavailable): ${article.snippet}`
        : "(Only the headline is available — body could not be fetched.)";

    const prompt = [
      "Summarise this news story in plain English for a smart adult who has not been following this topic.",
      "Return ONLY a JSON object (no markdown fences, no prose before or after) with two fields:",
      "  - summary: the summary (rules below).",
      "  - terms: an array of named entities, organisations, conflicts, treaties, laws, or jargon phrases used IN your summary that a reader unfamiliar with the topic would benefit from having explained. Use the exact form/spelling as it appears in your summary. Prefer proper nouns and multi-word phrases. Skip generic words. 0–8 terms.",
      "",
      "Summary rules:",
      "- Write clearly and directly. Not dumbed down, not patronising — 'a well-read friend explaining what happened'.",
      "- Cut the filler: boilerplate, background everyone knows, hedging caveats, quote padding.",
      "- Keep every important number and specific (amounts, percentages, dates, counts, money, timelines, named products/models, quoted terms of a deal). Embed them naturally.",
      "- If this is about a deal/investment/partnership: state the terms and what each side gets (cash/equity, compute, exclusivity, access, governance/board rights, timelines, conditions) if the article provides it.",
      "- If the article mentions uncertainty or 'talks': be explicit about what is confirmed vs. not.",
      "- Name the key people, places, and organisations involved.",
      "- 4 to 6 sentences. Dense but readable. No headings, no bullet points, no preamble.",
      "- Use British English.",
      hasContent
        ? "- The article body below is authoritative — do not contradict it."
        : "- The full body was unavailable. Do NOT refuse. Write a best-effort summary using the title, source, snippet, and your background knowledge. End with '(Summary based on limited info — full article unavailable.)'",
      "",
      `Title: ${article.title}`,
      `Source: ${article.source}`,
      `URL: ${article.url}`,
      "",
      "Article:",
      body,
    ].join("\n");

    const { value: raw, model: modelUsed } = await withModelFallback(async (modelName) => {
      const client = getClient();
      const model = client.getGenerativeModel(
        isGemma(modelName)
          ? { model: modelName }
          : {
              model: modelName,
              generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                  type: SchemaType.OBJECT,
                  properties: {
                    summary: { type: SchemaType.STRING },
                    terms: {
                      type: SchemaType.ARRAY,
                      items: { type: SchemaType.STRING },
                    },
                  },
                  required: ["summary", "terms"],
                },
              },
            },
      );
      const result = await withRetry(() => model.generateContent(prompt));
      return result.response.text();
    });

    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "");

    try {
      const parsed = JSON.parse(cleaned) as ArticleSummaryResult;
      return {
        summary: parsed.summary.trim(),
        terms: Array.isArray(parsed.terms)
          ? parsed.terms.filter((t) => typeof t === "string" && t.trim().length > 0)
          : [],
        model: modelUsed,
      };
    } catch {
      return { summary: cleaned.trim() || raw.trim(), terms: [], model: modelUsed };
    }
  }

  async defineTerm({ term }: { term: string }): Promise<string> {
    const prompt = [
      `Define "${term}" in the context of current affairs/news.`,
      "Rules:",
      "- 2-3 short sentences. Plain English. British spelling.",
      "- Start with what it is (a group / event / treaty / person / law / etc.).",
      "- Include the most important specifics a news reader would want (who, when, key numbers if relevant).",
      "- No preamble, no 'Here is a definition'. Just the explanation.",
      "",
      "Definition:",
    ].join("\n");

    const { value } = await withModelFallback(async (modelName) => {
      const client = getClient();
      const model = client.getGenerativeModel({ model: modelName });
      const result = await withRetry(() => model.generateContent(prompt));
      return result.response.text().trim();
    });
    return value;
  }

  async generateTagQuery({ name }: { name: string }): Promise<string> {
    const draft = await draftTagQuery(name);
    const draftBest = extractBestQuery(draft, name);
    if (process.env.AI_TAG_QUERY_REFINE !== "1") return draftBest;

    try {
      const refined = await refineTagQuery(name, draftBest);
      return pickBestQuery([draftBest, refined], name) ?? draftBest;
    } catch {
      // If refinement fails (quota/transient), keep the usable draft.
      return draftBest;
    }
  }
}
