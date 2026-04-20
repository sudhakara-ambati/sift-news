export type FetchedArticle = {
  title: string;
  url: string;
  source: string;
  publishedAt: Date;
  snippet: string | null;
  imageUrl: string | null;
  tagIds: string[];
};
