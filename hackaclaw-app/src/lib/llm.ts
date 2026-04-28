/**
 * Multi-provider LLM abstraction.
 *
 * Supports Gemini, OpenAI, Claude, and Kimi (Moonshot).
 * API keys are used per-request and NEVER stored or logged.
 */

import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

export type LLMProvider = "gemini" | "openai" | "claude" | "kimi";

const VALID_PROVIDERS: LLMProvider[] = ["gemini", "openai", "claude", "kimi"];

export function isValidProvider(provider: string): provider is LLMProvider {
  return VALID_PROVIDERS.includes(provider as LLMProvider);
}

interface GenerateCodeOptions {
  provider: LLMProvider;
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
}

interface GenerateCodeResult {
  text: string;
  provider: LLMProvider;
  model: string;
}

/**
 * Generate code using the agent's own LLM API key.
 * The key is used for this one call and never persisted.
 */
export async function generateCode(opts: GenerateCodeOptions): Promise<GenerateCodeResult> {
  const { provider, apiKey, systemPrompt, userPrompt } = opts;
  const maxTokens = opts.maxTokens ?? 32000;
  const temperature = opts.temperature ?? 0.7;

  switch (provider) {
    case "gemini":
      return generateGemini(apiKey, systemPrompt, userPrompt, maxTokens, temperature);
    case "openai":
      return generateOpenAI(apiKey, systemPrompt, userPrompt, maxTokens, temperature);
    case "claude":
      return generateClaude(apiKey, systemPrompt, userPrompt, maxTokens, temperature);
    case "kimi":
      return generateKimi(apiKey, systemPrompt, userPrompt, maxTokens, temperature);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

// ─── Gemini ───

async function generateGemini(
  apiKey: string, system: string, user: string, maxTokens: number, temperature: number
): Promise<GenerateCodeResult> {
  const genai = new GoogleGenAI({ apiKey });
  const model = "gemini-2.0-flash";

  const response = await genai.models.generateContent({
    model,
    contents: user,
    config: {
      systemInstruction: system,
      maxOutputTokens: maxTokens,
      temperature,
    },
  });

  return { text: response?.text || "", provider: "gemini", model };
}

// ─── OpenAI ───

async function generateOpenAI(
  apiKey: string, system: string, user: string, maxTokens: number, temperature: number
): Promise<GenerateCodeResult> {
  const client = new OpenAI({ apiKey });
  const model = "gpt-4o";

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: maxTokens,
    temperature,
  });

  return { text: response.choices[0]?.message?.content || "", provider: "openai", model };
}

// ─── Claude ───

async function generateClaude(
  apiKey: string, system: string, user: string, maxTokens: number, temperature: number
): Promise<GenerateCodeResult> {
  const client = new Anthropic({ apiKey });
  const model = "claude-sonnet-4-20250514";

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    temperature,
    system,
    messages: [{ role: "user", content: user }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  return { text, provider: "claude", model };
}

// ─── Kimi (Moonshot — OpenAI-compatible) ───

async function generateKimi(
  apiKey: string, system: string, user: string, maxTokens: number, temperature: number
): Promise<GenerateCodeResult> {
  const client = new OpenAI({
    apiKey,
    baseURL: "https://api.moonshot.cn/v1",
  });
  const model = "moonshot-v1-8k";

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: maxTokens,
    temperature,
  });

  return { text: response.choices[0]?.message?.content || "", provider: "kimi", model };
}
