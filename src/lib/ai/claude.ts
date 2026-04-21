import type { AIProvider } from ".";

export class ClaudeProvider implements AIProvider {
  async askAboutArticle(): Promise<string> {
    throw new Error("Claude provider not yet implemented. Set AI_PROVIDER=gemini.");
  }

  async askAboutArticleStream(): Promise<{ stream: AsyncIterable<string>; model: string }> {
    throw new Error("Claude provider not yet implemented. Set AI_PROVIDER=gemini.");
  }

  async generateTagQuery(): Promise<string> {
    throw new Error("Claude provider not yet implemented. Set AI_PROVIDER=gemini.");
  }

  async summarizeArticle(): Promise<{ summary: string; terms: string[] }> {
    throw new Error("Claude provider not yet implemented. Set AI_PROVIDER=gemini.");
  }

  async defineTerm(): Promise<string> {
    throw new Error("Claude provider not yet implemented. Set AI_PROVIDER=gemini.");
  }
}
