import { generateObject } from "ai";
import { openai as openaiProvider, createOpenAI } from "@ai-sdk/openai";
import { anthropic as anthropicProvider } from "@ai-sdk/anthropic";
import { groq as groqProvider } from "@ai-sdk/groq";
import type { LanguageModelV1 } from "ai";

export type LLMProvider = "openai" | "anthropic" | "groq" | "ollama";

const DEFAULT_MODELS: Record<LLMProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-4-5-20251001",
  groq: "llama-3.1-8b-instant",
  ollama: "llama3.2",
};

export function getModel(): LanguageModelV1 {
  const provider = (process.env.LLM_PROVIDER ?? "openai") as LLMProvider;
  const modelId = process.env.LLM_MODEL ?? DEFAULT_MODELS[provider];

  switch (provider) {
    case "openai":
      return openaiProvider(modelId);
    case "anthropic":
      return anthropicProvider(modelId);
    case "groq":
      return groqProvider(modelId);
    case "ollama": {
      const ollama = createOpenAI({
        baseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
        apiKey: "ollama",
      });
      return ollama(modelId);
    }
    default:
      throw new Error(
        `Unsupported LLM_PROVIDER: "${provider}". Valid options: openai, anthropic, groq, ollama`
      );
  }
}

export { generateObject };

// Mutable deps object — lets tests replace generateObject without module-level mocking
export const _deps = { generateObject };
