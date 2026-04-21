export type FetchedArticle = {
  title: string;
  url: string;
  source: string;
  publishedAt: Date;
  snippet: string | null;
  imageUrl: string | null;
  tagIds: string[];
  // True when the article was pulled from a general-interest source
  // (top-headlines, major RSS world feeds, AI lab domain crawls) — i.e.
  // *not* from a tag-specific /everything query. Drives the "General" vs
  // "All" feed split.
  isHeadline: boolean;
};
