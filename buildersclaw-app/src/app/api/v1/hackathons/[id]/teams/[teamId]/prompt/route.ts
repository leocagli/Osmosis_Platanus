import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { authenticateRequest } from "@/lib/auth";
import { success, error, unauthorized, notFound } from "@/lib/responses";
import { v4 as uuid } from "uuid";
import { chatCompletion, estimateCost, type ChatMessage } from "@/lib/openrouter";
import { canAfford, chargeForPrompt, InsufficientBalanceError, PLATFORM_FEE_PCT } from "@/lib/balance";
import { slugify } from "@/lib/github";
import { sanitizePrompt, sanitizeGeneratedOutput } from "@/lib/prompt-security";
import { parseHackathonMeta } from "@/lib/hackathons";

type RouteParams = { params: Promise<{ id: string; teamId: string }> };

/**
 * POST /api/v1/hackathons/:id/teams/:teamId/prompt
 *
 * The agent sends a prompt + chooses an OpenRouter model.
 * We check their balance, execute the prompt, charge them (cost + 5% fee).
 *
 * Body: {
 *   prompt: string,          — what to build/improve
 *   model?: string,          — OpenRouter model ID (default: google/gemini-2.5-flash-lite)
 *   max_tokens?: number,     — max output tokens (default: 4096)
 *   temperature?: number,    — creativity 0-2 (default: 0.7)
 *   system_prompt?: string,  — optional custom system prompt override
  * }
 *
 * Prompt generation is intentionally decoupled from final submission.
 * Agents must push the generated files to their own GitHub repo and then call
 * POST /submit with that repo URL.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  const { id: hackathonId, teamId } = await params;

  // Parse body — NO system_prompt override allowed (security)
  let body: {
    prompt?: string;
    model?: string;
    max_tokens?: number;
    temperature?: number;
  };
  try {
    body = await req.json();
  } catch {
    return error("Invalid request body", 400);
  }

  const modelId = body.model?.trim() || "google/gemini-2.5-flash-lite";
  const maxTokens = Math.min(Math.max(1, body.max_tokens || 4096), 32000);
  const temperature = Math.min(Math.max(0, body.temperature ?? 0.7), 2);

  // ── PROMPT VALIDATION + INJECTION DETECTION ──

  if (!body.prompt || !body.prompt.trim()) {
    return error("prompt is required", 400, "Send a text prompt describing what to build or improve.");
  }
  if (body.prompt.length > 10000) {
    return error("Prompt too long. Max 10,000 characters.", 400);
  }

  const sanitized = sanitizePrompt(body.prompt);
  if (!sanitized.safe) {
    return error(
      `Prompt rejected: ${sanitized.blocked_reason}`,
      400,
      "Send a clear description of what to build. No meta-instructions."
    );
  }
  const promptText = sanitized.cleaned;

  // Validate hackathon
  const { data: hackathon } = await supabaseAdmin
    .from("hackathons").select("*").eq("id", hackathonId).single();
  if (!hackathon) return notFound("Hackathon");

  if (!["open", "in_progress"].includes(hackathon.status)) {
    return error("Hackathon is not accepting prompts", 400, `Current status: ${hackathon.status}`);
  }

  // ── START TIME CHECK ──
  if (hackathon.starts_at && new Date(hackathon.starts_at).getTime() > Date.now()) {
    return error("Hackathon has not started yet", 400, `Starts at: ${hackathon.starts_at}`);
  }

  // ── DEADLINE CHECK ──
  if (hackathon.ends_at) {
    const deadline = new Date(hackathon.ends_at);
    if (!isNaN(deadline.getTime()) && deadline.getTime() <= Date.now()) {
      return error(
        "Hackathon deadline has passed",
        400,
        `Deadline was: ${hackathon.ends_at}. No more prompts accepted.`
      );
    }
  }

  // Validate team membership
  const { data: team } = await supabaseAdmin
    .from("teams").select("*").eq("id", teamId).eq("hackathon_id", hackathonId).single();
  if (!team) return notFound("Team");

  const { data: membership } = await supabaseAdmin
    .from("team_members").select("*").eq("team_id", teamId).eq("agent_id", agent.id).single();
  if (!membership) return error("You are not a member of this team", 403);

  // ── RATE LIMIT: max 1 prompt per 10 seconds per agent ──
  const { data: recentPrompt } = await supabaseAdmin
    .from("prompt_rounds")
    .select("created_at")
    .eq("agent_id", agent.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (recentPrompt) {
    const lastPromptAt = new Date(recentPrompt.created_at).getTime();
    const cooldownMs = 10_000; // 10 seconds
    const elapsed = Date.now() - lastPromptAt;
    if (elapsed < cooldownMs) {
      const waitSec = Math.ceil((cooldownMs - elapsed) / 1000);
      return error(
        `Rate limited. Wait ${waitSec} more second(s) before sending another prompt.`,
        429,
        "Max 1 prompt every 10 seconds."
      );
    }
  }

  // Determine round number
  const { count: existingRounds } = await supabaseAdmin
    .from("prompt_rounds")
    .select("*", { count: "exact", head: true })
    .eq("team_id", teamId)
    .eq("hackathon_id", hackathonId);

  const roundNumber = (existingRounds || 0) + 1;

  // Get previous round's code (for context in iteration)
  let previousCode = "";
  if (roundNumber > 1) {
    const { data: prevRound } = await supabaseAdmin
      .from("prompt_rounds")
      .select("files")
      .eq("team_id", teamId)
      .eq("hackathon_id", hackathonId)
      .order("round_number", { ascending: false })
      .limit(1)
      .single();

    if (prevRound?.files) {
      const prevFiles = prevRound.files as { path: string; content: string }[];
      previousCode = prevFiles.map(f => `--- ${f.path} ---\n${f.content}`).join("\n\n");
    }
  }

  // Parse hackathon meta for judging criteria
  const hackathonMeta = parseHackathonMeta(hackathon.judging_criteria);

  // Build messages — system prompt is ALWAYS platform-controlled (no override)
  const systemPrompt = buildSystemPrompt(
    {
      title: hackathon.title,
      brief: hackathon.brief,
      description: hackathon.description || null,
      rules: hackathon.rules || null,
      judging_criteria: hackathonMeta.criteria_text,
      ends_at: hackathon.ends_at || null,
      github_repo: null,
      team_slug: slugify(team.name),
    },
    agent.personality || "",
    agent.strategy || "",
    team.name,
    hackathon.challenge_type || "landing_page",
    previousCode,
    roundNumber,
  );

  const userPrompt = buildUserPrompt(promptText, roundNumber, previousCode);

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  // ── PRE-FLIGHT: Estimate cost and check balance ──

  let estimate;
  try {
    estimate = await estimateCost({ model: modelId, messages, max_tokens: maxTokens });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown model";
    return error(msg, 400, "Use GET /api/v1/models to see available models.");
  }

  const affordCheck = await canAfford(agent.id, estimate.estimated_cost_usd);
  if (!affordCheck.can_afford) {
    return error(
      `Insufficient balance. Estimated cost: $${affordCheck.estimated_total.toFixed(6)} (includes ${PLATFORM_FEE_PCT * 100}% fee). Your balance: $${affordCheck.balance_usd.toFixed(6)}`,
      402,
      "Deposit USDC via POST /api/v1/balance to fund your account."
    );
  }

  // ── EXECUTE: Call OpenRouter ──

  // Update hackathon status to in_progress if open
  if (hackathon.status === "open") {
    await supabaseAdmin.from("hackathons")
      .update({ status: "in_progress", updated_at: new Date().toISOString() })
      .eq("id", hackathonId);
  }

  let result;
  try {
    result = await chatCompletion({
      model: modelId,
      messages,
      max_tokens: maxTokens,
      temperature,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "LLM call failed";
    return error(`Code generation failed: ${msg}`, 502, "Try a different model or try again.");
  }

  // ── CHARGE: Deduct actual cost + 5% fee ──

  const roundId = uuid();
  let charge;

  try {
    charge = await chargeForPrompt({
      agentId: agent.id,
      modelCostUsd: result.cost_usd,
      referenceId: roundId,
      metadata: {
        model: result.model,
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
        hackathon_id: hackathonId,
        team_id: teamId,
        round_number: roundNumber,
      },
    });
  } catch (err) {
    if (err instanceof InsufficientBalanceError) {
      // Edge case: estimate was OK but actual cost exceeded balance
      return error(err.message, 402, "Deposit more USDC via POST /api/v1/balance");
    }
    throw err;
  }

  // ── PARSE & STORE ──

  const rawFiles = parseGeneratedFiles(result.text, hackathon.challenge_type || "landing_page");

  // Sanitize generated output (strip exfil attempts, etc.)
  const files = rawFiles.map(f => ({
    path: f.path,
    content: sanitizeGeneratedOutput(f.content),
  }));

  // Store round in DB
  await supabaseAdmin.from("prompt_rounds").insert({
    id: roundId,
    team_id: teamId,
    hackathon_id: hackathonId,
    agent_id: agent.id,
    round_number: roundNumber,
    prompt_text: promptText,
    llm_provider: "openrouter",
    llm_model: result.model,
    files,
    commit_sha: null,
    cost_usd: result.cost_usd,
    fee_usd: charge.fee,
    input_tokens: result.input_tokens,
    output_tokens: result.output_tokens,
    created_at: new Date().toISOString(),
  });

  await supabaseAdmin.from("teams").update({ status: "building" }).eq("id", teamId);

  // Activity log
  await supabaseAdmin.from("activity_log").insert({
    id: uuid(),
    hackathon_id: hackathonId,
    team_id: teamId,
    agent_id: agent.id,
    event_type: "prompt_submitted",
    event_data: {
      round: roundNumber,
      model: result.model,
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
      cost_usd: result.cost_usd,
      fee_usd: charge.fee,
      total_charged_usd: charge.total_charged,
      balance_after_usd: charge.balance_after,
      duration_ms: result.duration_ms,
      file_count: files.length,
      prompt_length: promptText.length,
    },
  });

  return success({
    round: roundNumber,
    model: result.model,
    billing: {
      model_cost_usd: result.cost_usd,
      fee_usd: charge.fee,
      fee_pct: PLATFORM_FEE_PCT,
      total_charged_usd: charge.total_charged,
      balance_after_usd: charge.balance_after,
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
    },
    files: files.map(f => ({ path: f.path, size: f.content.length })),
    file_contents: files.map(f => ({ path: f.path, content: f.content })),
    github: null,
    duration_ms: result.duration_ms,
    hint: roundNumber === 1
      ? "Round 1 complete. Push these files to your own GitHub repo, then submit that repo URL when you are ready."
      : `Round ${roundNumber} complete. Push the updated files to your own GitHub repo, then resubmit when ready.`,
    next_steps: [
      "Create or update your own public GitHub repository locally.",
      "Commit and push these generated files to that repository.",
      `Call POST /api/v1/hackathons/${hackathonId}/teams/${teamId}/submit with {\"repo_url\":\"https://github.com/owner/repo\"}.`,
    ],
  });
}

// ─── Prompt builders ───

function buildSystemPrompt(
  hackathon: { title: string; brief: string; description?: string | null; rules?: string | null; judging_criteria?: string | null; ends_at?: string | null; github_repo?: string | null; team_slug?: string },
  personality: string,
  strategy: string,
  teamName: string,
  challengeType: string,
  previousCode: string,
  roundNumber: number,
): string {
  const projectFormat = challengeType === "landing_page"
    ? `OUTPUT FORMAT:
Output a SINGLE self-contained HTML file.
- ALL CSS in a <style> tag
- ALL JavaScript in a <script> tag
- NO external dependencies (except Google Fonts via @import)
- Must be responsive (mobile + desktop)
- Include smooth animations and micro-interactions`
    : `OUTPUT FORMAT:
Output a COMPLETE PROJECT with multiple files.
Use this exact format for EACH file:

===FILE: path/to/file.ext===
(file content here)
===END_FILE===

One file MUST be named "demo.html" — a self-contained HTML file showcasing the project.`;

  const iterationContext = previousCode
    ? `\nYou are on ROUND ${roundNumber}. The agent is iterating on their previous submission.\nThe previous code is provided in the user message. Apply the agent's new instructions to improve it.\nDo NOT start from scratch — build on the existing code.`
    : "";

  // Build rich hackathon context
  const hackathonContext = [
    `HACKATHON: ${hackathon.title}`,
    "",
    `CHALLENGE BRIEF:`,
    hackathon.brief,
    hackathon.description ? `\nDESCRIPTION:\n${hackathon.description}` : "",
    hackathon.rules ? `\nRULES:\n${hackathon.rules}` : "",
    hackathon.judging_criteria ? `\nJUDGING CRITERIA:\n${hackathon.judging_criteria}` : "",
    hackathon.ends_at ? `\nDEADLINE: ${hackathon.ends_at}` : "",
    "\nREPOSITORY RULE: You are generating files only. The agent must create and manage its own GitHub repository outside this prompt flow.",
  ].filter(Boolean).join("\n");

  return `You are building a project for team "${teamName}" in a hackathon competition.

AGENT PROFILE:
${personality ? `- Personality: ${personality}` : "- No personality defined"}
${strategy ? `- Strategy: ${strategy}` : "- No strategy defined"}

${hackathonContext}

${projectFormat}
${iterationContext}

Output ONLY code. No explanations, no markdown fences around the entire output.`;
}

function buildUserPrompt(agentPrompt: string, roundNumber: number, previousCode: string): string {
  if (roundNumber === 1) {
    return agentPrompt;
  }
  return `PREVIOUS CODE:\n${previousCode.substring(0, 20000)}\n\n---\n\nAGENT INSTRUCTIONS FOR ROUND ${roundNumber}:\n${agentPrompt}`;
}

// ─── Parse output ───

function parseGeneratedFiles(text: string, challengeType: string): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];
  const fileRegex = /===FILE:\s*(.+?)===\s*\n([\s\S]*?)===END_FILE===/g;
  let match;

  while ((match = fileRegex.exec(text)) !== null) {
    const filePath = match[1].trim();
    const content = match[2].trim();
    if (filePath && content) {
      files.push({ path: filePath, content });
    }
  }

  if (files.length > 0) return files;

  const html = extractHTML(text);
  if (html) {
    return [{ path: challengeType === "landing_page" ? "index.html" : "demo.html", content: html }];
  }

  const codeBlocks = text.matchAll(/```(\w+)?\s*\n([\s\S]*?)```/g);
  let idx = 0;
  for (const block of codeBlocks) {
    const lang = block[1] || "txt";
    const content = block[2].trim();
    if (content.length > 20) {
      files.push({ path: `file_${idx}.${langToExt(lang)}`, content });
      idx++;
    }
  }

  return files;
}

function extractHTML(text: string): string | null {
  const codeBlockMatch = text.match(/```html\s*([\s\S]*?)```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();
  const htmlMatch = text.match(/(<!DOCTYPE html[\s\S]*<\/html>)/i);
  if (htmlMatch) return htmlMatch[1].trim();
  const htmlMatch2 = text.match(/(<html[\s\S]*<\/html>)/i);
  if (htmlMatch2) return htmlMatch2[1].trim();
  if (text.trim().startsWith("<!DOCTYPE") || text.trim().startsWith("<html")) return text.trim();
  return null;
}

function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    py: "python", rs: "rust", go: "go", html: "html", css: "css",
    json: "json", md: "markdown", sql: "sql", sh: "shell", sol: "solidity",
  };
  return map[ext] || ext || "text";
}

function langToExt(lang: string): string {
  const map: Record<string, string> = {
    typescript: "ts", javascript: "js", python: "py", html: "html",
    css: "css", json: "json", markdown: "md", sql: "sql", shell: "sh",
  };
  return map[lang] || lang;
}
