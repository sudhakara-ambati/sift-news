import { GeminiProvider } from "./gemini";
import { ClaudeProvider } from "./claude";

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export type ArticleContext = {
  title: string;
  source: string;
  url: string;
  content: string | null;
  snippet: string | null;
};

export type ArticleSummaryResult = {
  summary: string;
  terms: string[];
  model?: string;
};

export type ChatStreamResult = {
  stream: AsyncIterable<string>;
  model: string;
};

export interface AIProvider {
  askAboutArticle(args: {
    article: ArticleContext;
    question: string;
    history: ChatTurn[];
  }): Promise<string>;

  askAboutArticleStream(args: {
    article: ArticleContext;
    question: string;
    history: ChatTurn[];
  }): Promise<ChatStreamResult>;

  generateTagQuery(args: { name: string }): Promise<string>;

  summarizeArticle(args: {
    article: ArticleContext;
  }): Promise<ArticleSummaryResult>;

  defineTerm(args: { term: string }): Promise<string>;
}

export function isGroundedModel(modelName: string | undefined | null): boolean {
  if (!modelName) return false;
  return modelName.startsWith("gemini-");
}

export function getAIProvider(): AIProvider {
  const provider = (process.env.AI_PROVIDER ?? "gemini").toLowerCase();
  if (provider === "claude") return new ClaudeProvider();
  return new GeminiProvider();
}
