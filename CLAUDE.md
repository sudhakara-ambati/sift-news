# Project: Personal AI News Aggregator

Build a full-stack web application that serves as a personalised news aggregator with AI-powered follow-up questions. This is a single-user personal project — I am the only user.

## Tech stack

- Framework: Next.js 14+ with App Router, TypeScript
- Styling: Tailwind CSS
- Database: SQLite via Prisma ORM (for local dev; can migrate to Turso later)
- AI provider: Google Gemini via @google/generative-ai SDK, with abstraction layer so I can swap to Claude API later
- News sources: NewsAPI.org (primary) + RSS feeds from BBC, Guardian, Reuters (fallback/supplementary)
- Auth: Simple single-user password auth via NextAuth.js credentials provider (no sign-ups, just me)
- Deployment target: Vercel (free tier) with Vercel Cron for scheduled news fetching

## Core features

### 1. News feed
- Home page showing ranked list of "biggest stories of the day"
- Ranking signals: cluster size across outlets, recency, source weight, tag match bonus
- Each item shows: title, source, published time, short snippet, thumbnail if available
- Clicking an article opens the article detail view

### 2. Custom tags
- User can add/remove topic tags (e.g. "AI", "UK politics", "Israel-Iran war")
- Each tag has a name and associated query terms (used for NewsAPI /everything searches)
- Feed has tag filter chips at top — clicking a tag filters feed to that topic
- Tagged articles get a score boost in the main feed

### 3. Article detail + AI chat
- Full article view: title, source, published time, full content (or snippet + link if full content unavailable)
- Chat interface beside/below the article
- User can ask follow-up questions; AI responds based on article content
- Conversation history is stored per-article (persisted in DB) so returning to an article restores the chat
- Chat uses Gemini via an abstraction layer — structure the AI client so I can swap providers by changing one file

#### Article content strategy
- NewsAPI free tier only returns ~200 chars of content (plus `[+X chars]` marker). Do NOT fetch full content during the scheduled news fetch.
- Instead, fetch full content just-in-time: when the user opens an article and starts a chat, the backend fetches the article URL server-side and extracts the main content using `@extractus/article-extractor`.
- Cache the extracted content in `Article.content` so subsequent chats on the same article don't re-fetch.
- If extraction fails or returns very little text, fall back to the NewsAPI snippet plus the article URL in the AI prompt, with instructions to the model to acknowledge it has limited context.

### 4. Authentication (single-user)
- Only I should be able to access the app
- Use NextAuth.js with a credentials provider
- Password stored as a bcrypt hash in an env variable (ADMIN_PASSWORD_HASH)
- No user registration UI, no sign-up flow — just a login page
- Protect all app routes and API routes behind auth middleware
- Session persists for 30 days

### 5. Background news fetching
- Scheduled job (Vercel Cron or manually-triggerable API route) that runs every 2-4 hours
- Fetches top headlines from NewsAPI + configured RSS feeds
- Fetches articles for each active tag via NewsAPI /everything endpoint
- Deduplicates articles (cluster by title similarity — Jaccard similarity on title word sets is fine for v1)
- Stores to database, marks new articles for the feed

#### Request budget (NewsAPI free tier: 100 req/day)
Per cron run, make exactly:
- 1× `/top-headlines?category=general&language=en` — major international stories (no country filter)
- 1× `/top-headlines?sources=reuters,bbc-news,al-jazeera-english,bloomberg` — tier-1 wire services
- 1× `/everything?q=<queryTerms>&language=en` per active tag

At 4-hour cadence with ~5 tags, this is ~42 calls/day — well within budget. Deduplicate across all sources via the Jaccard clustering logic. `country=gb` was tested and returns 0 results on the free tier, so it is not used.

#### RSS feeds
International editions only (no UK-dominant lists):
- BBC World — `https://feeds.bbci.co.uk/news/world/rss.xml`
- Guardian World — `https://www.theguardian.com/world/rss`
- Al Jazeera English — `https://www.aljazeera.com/xml/rss/all.xml`
- NYT World — `https://rss.nytimes.com/services/xml/rss/nyt/World.xml`

Reuters and Associated Press official RSS feeds were deprecated years ago. Reuters coverage comes from the NewsAPI `sources=reuters` call above. **AP coverage is a known gap** — if it feels missing, add an unofficial / third-party AP feed to `src/lib/news/rss.ts` later.

#### Seed data
`prisma/seed.ts` seeds two tags for initial testing: "AI" (query: `AI OR artificial intelligence`) and "UK politics" (query: `UK politics OR Westminster OR Starmer`). Run via `npm run db:seed`.

## Database schema (Prisma)

Use this as a starting point — adjust as needed:

- Article: id, title, url (unique), source, publishedAt, snippet, content (optional), imageUrl, clusterId, score, tags relation, chatMessages relation, createdAt
- Tag: id, name (unique), queryTerms, createdAt, articles relation
- ArticleTag: join table with articleId and tagId (composite primary key)
- ChatMessage: id, articleId, role ('user' or 'assistant'), content, createdAt, article relation

Use Prisma's recommended syntax for relations and cascading deletes (chat messages and article-tag links cascade when the parent article is deleted).

## Project structure

Organise the codebase like this:

- prisma/schema.prisma
- src/app/(auth)/login/page.tsx
- src/app/(app)/page.tsx — home feed
- src/app/(app)/article/[id]/page.tsx — article detail + chat
- src/app/(app)/tags/page.tsx — manage tags
- src/app/api/auth/[...nextauth]/route.ts
- src/app/api/articles/route.ts — GET feed
- src/app/api/articles/[id]/chat/route.ts — POST chat message
- src/app/api/tags/route.ts — GET/POST/DELETE tags
- src/app/api/cron/fetch-news/route.ts — cron endpoint
- src/app/layout.tsx
- src/app/globals.css
- src/lib/ai/index.ts — unified AI interface
- src/lib/ai/gemini.ts — Gemini implementation
- src/lib/ai/claude.ts — Claude stub for later
- src/lib/news/newsapi.ts
- src/lib/news/rss.ts
- src/lib/news/ranking.ts — scoring + clustering
- src/lib/auth.ts — NextAuth config
- src/lib/db.ts — Prisma client singleton
- src/components/ArticleCard.tsx
- src/components/ArticleList.tsx
- src/components/ChatPanel.tsx
- src/components/TagChips.tsx
- src/components/LoginForm.tsx
- src/middleware.ts — auth protection

## AI abstraction layer

Create src/lib/ai/index.ts exporting an AIProvider interface with an askAboutArticle method. The method takes articleContent, articleTitle, question, and history (array of role/content pairs) and returns a Promise of a string.

Export a getAIProvider factory function that reads AI_PROVIDER from environment variables and returns either a GeminiProvider or ClaudeProvider instance. GeminiProvider wraps the @google/generative-ai SDK. ClaudeProvider can be stubbed to throw "not yet implemented" — I'll fill it in later if I get a Claude API key.

The Gemini prompt should instruct the model to answer based on the article content, be clear when speculating beyond it, and use any conversation history for context.

## Ranking algorithm (v1)

In src/lib/news/ranking.ts, implement scoring as a weighted sum:
- 0.4 * normalised cluster size (how many outlets cover the same story)
- 0.3 * recency factor (exponential decay over 24 hours)
- 0.2 * source weight (BBC, Reuters, Guardian = 1.0; others = 0.5; define a source weights map)
- 0.1 * tag match bonus (1.0 if article matches any active tag, else 0)

For deduplication, compute Jaccard similarity on sets of title words (lowercased, with English stopwords removed). If two articles have similarity greater than 0.6, they belong to the same cluster. Assign a shared clusterId.

## Environment variables

Create a .env.example file with these keys (no real values):
- DATABASE_URL (set to file:./dev.db for local SQLite)
- NEXTAUTH_SECRET (random string, generate with openssl rand -base64 32)
- NEXTAUTH_URL (http://localhost:3000 for dev)
- ADMIN_USERNAME
- ADMIN_PASSWORD_HASH (bcrypt hash, generate with a small helper script)
- NEWSAPI_KEY (from newsapi.org)
- GEMINI_API_KEY (from aistudio.google.com)
- AI_PROVIDER (default: gemini)
- CRON_SECRET (random string; cron endpoint checks this in a header to prevent abuse)

Also include a small scripts/hash-password.ts that takes a password as argv[2] and prints its bcrypt hash, so I can generate ADMIN_PASSWORD_HASH without needing a signup flow.

## PWA setup

Include:
- public/manifest.json with name "News Feed", short_name "News", dark theme colour, display standalone, start_url /
- App icons at 192x192 and 512x512 (use a simple SVG newspaper placeholder)
- Basic service worker that caches the app shell (not article content — that stays fresh)
- Viewport meta tags for proper mobile rendering
- Apple-specific meta tags for iOS home screen installation (apple-mobile-web-app-capable, apple-touch-icon)

## Styling direction

- Dark theme by default
- Clean, minimal, text-focused — think Readwise or Matter, not Apple News
- Sans-serif for UI, serif for article body
- Responsive: single column on mobile, two columns on desktop (feed list + article/chat)
- Subtle card-based article list, no heavy shadows or borders

## Build priorities

Build in this order. Each step should be fully working before moving to the next:

1. Foundation — Next.js project scaffolded, Prisma schema + migrations, SQLite DB, Tailwind config, basic layout with header and nav
2. Auth — NextAuth credentials provider, login page, password hash helper script, middleware route protection, verify I can log in and out
3. News fetching — NewsAPI client, RSS parser, ranking + dedup, cron endpoint (manually triggerable via GET with CRON_SECRET), verify articles land in DB
4. Feed UI — home page rendering article cards from DB, tag filter chips, responsive layout
5. Tags UI — tags management page (list, add, delete)
6. Article detail — full article view page with content/snippet and source link
7. AI chat — abstraction layer, Gemini implementation, chat API route, chat panel UI with persistent history
8. PWA — manifest, service worker, icons, installability testing on mobile
9. Deployment — Vercel deployment, Vercel Cron config, production env vars, verify full flow end-to-end on deployed URL

## Coding standards

- TypeScript strict mode
- Use server components where possible; client components only when interactivity requires
- Use async server actions for mutations where appropriate
- Keep components small and focused
- Environment variables accessed via a typed config module, not process.env scattered through the code
- Error handling: try/catch on all external API calls with sensible fallbacks
- British English in any user-facing copy

## Start here

Begin by scaffolding the Next.js project with TypeScript, Tailwind, and App Router. Set up Prisma with the SQLite schema above and run the initial migration. Create the basic layout component with a header and an empty main area. Then confirm the dev server runs cleanly before moving on to auth.

Ask me clarifying questions before proceeding if anything is ambiguous or if you need me to make design choices I haven't specified.