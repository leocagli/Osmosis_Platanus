/**
 * OpenRouter API client — unified proxy for 290+ LLM models.
 *
 * Uses the OpenAI SDK with OpenRouter's base URL.
 * Env: OPENROUTER_API_KEY
 */

import OpenAI from "openai";

// ─── Types ───

export interface OpenRouterModel {
  id: string;
  name: string;
  description: string;
  context_length: number;
  pricing: {
    prompt: string;   // USD per token (string for precision)
    completion: string;
    request: string;
    image: string;
  };
  top_provider: {
    context_length: number;
    max_completion_tokens: number;
    is_moderated: boolean;
  } | null;
  architecture: {
    modality: string;
    tokenizer: string;
    instruct_type: string | null;
  } | null;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface PromptResult {
  id: string;
  model: string;
  text: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  /** Actual cost in USD (prompt + completion tokens) */
  cost_usd: number;
  finish_reason: string | null;
  duration_ms: number;
}

// ─── Client ───

let cachedClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (cachedClient) return cachedClient;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("Missing OPENROUTER_API_KEY environment variable");

  cachedClient = new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "https://buildersclaw.com",
      "X-Title": "BuildersClaw",
    },
  });

  return cachedClient;
}

// ─── Models ───

let modelsCache: { data: OpenRouterModel[]; fetchedAt: number } | null = null;
const MODELS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function listModels(): Promise<OpenRouterModel[]> {
  if (modelsCache && Date.now() - modelsCache.fetchedAt < MODELS_CACHE_TTL) {
    return modelsCache.data;
  }

  const res = await fetch("https://openrouter.ai/api/v1/models", {
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch OpenRouter models: ${res.status}`);
  }

  const json = await res.json();
  const models: OpenRouterModel[] = (json.data || []).filter(
    (m: OpenRouterModel) => m.pricing && (parseFloat(m.pricing.prompt) > 0 || parseFloat(m.pricing.completion) > 0)
  );

  modelsCache = { data: models, fetchedAt: Date.now() };
  return models;
}

export async function getModelPricing(modelId: string): Promise<{
  prompt_per_token: number;
  completion_per_token: number;
  found: boolean;
}> {
  const models = await listModels();
  const model = models.find((m) => m.id === modelId);

  if (!model) {
    return { prompt_per_token: 0, completion_per_token: 0, found: false };
  }

  return {
    prompt_per_token: parseFloat(model.pricing.prompt) || 0,
    completion_per_token: parseFloat(model.pricing.completion) || 0,
    found: true,
  };
}

// ─── Chat Completion ───

export async function chatCompletion(options: {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
}): Promise<PromptResult> {
  const client = getClient();
  const { model, messages, max_tokens, temperature } = options;

  // Get pricing for cost calculation
  const pricing = await getModelPricing(model);

  const startMs = Date.now();

  const response = await client.chat.completions.create({
    model,
    messages,
    max_tokens: max_tokens ?? 4096,
    temperature: temperature ?? 0.7,
  });

  const durationMs = Date.now() - startMs;

  const choice = response.choices?.[0];
  const usage = response.usage;

  const inputTokens = usage?.prompt_tokens ?? 0;
  const outputTokens = usage?.completion_tokens ?? 0;

  // Calculate actual cost
  const costUsd =
    inputTokens * pricing.prompt_per_token +
    outputTokens * pricing.completion_per_token;

  return {
    id: response.id || "",
    model: response.model || model,
    text: choice?.message?.content || "",
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
    cost_usd: costUsd,
    finish_reason: choice?.finish_reason || null,
    duration_ms: durationMs,
  };
}

// ─── Cost Estimation (pre-call) ───

/**
 * Estimate the cost of a prompt before executing it.
 * Uses rough token estimation: ~4 chars per token.
 */
export async function estimateCost(options: {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
}): Promise<{
  estimated_input_tokens: number;
  max_output_tokens: number;
  estimated_cost_usd: number;
  pricing: { prompt_per_token: number; completion_per_token: number };
}> {
  const pricing = await getModelPricing(options.model);

  if (!pricing.found) {
    throw new Error(`Model not found: ${options.model}`);
  }

  // Estimate input tokens (~4 chars per token)
  const totalChars = options.messages.reduce((sum, m) => sum + m.content.length, 0);
  const estimatedInputTokens = Math.ceil(totalChars / 4);
  const maxOutputTokens = options.max_tokens ?? 4096;

  // Worst-case cost estimate
  const estimatedCost =
    estimatedInputTokens * pricing.prompt_per_token +
    maxOutputTokens * pricing.completion_per_token;

  return {
    estimated_input_tokens: estimatedInputTokens,
    max_output_tokens: maxOutputTokens,
    estimated_cost_usd: estimatedCost,
    pricing,
  };
}
