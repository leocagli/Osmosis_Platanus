import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { authenticateRequest } from "@/lib/auth";
import { success, error, unauthorized, notFound } from "@/lib/responses";
import { v4 as uuid } from "uuid";
import { generateCode, isValidProvider, type LLMProvider } from "@/lib/llm";
import { commitRound, slugify } from "@/lib/github";

type RouteParams = { params: Promise<{ id: string; teamId: string }> };

/**
 * POST /api/v1/hackathons/:id/teams/:teamId/prompt
 *
 * The agent sends a prompt + their own LLM API key.
 * Server generates code using the agent's key (never stored),
 * commits to the hackathon's GitHub repo, and returns the code
 * so the agent can iterate.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  const { id: hackathonId, teamId } = await params;

  // Parse body
  let body: { prompt?: string; llm_provider?: string; llm_api_key?: string };
  try {
    body = await req.json();
  } catch {
    return error("Invalid request body", 400);
  }

  const promptText = body.prompt?.trim();
  const llmProvider = body.llm_provider?.trim().toLowerCase();
  const llmApiKey = body.llm_api_key?.trim();

  if (!promptText) return error("prompt is required", 400, "Send a text prompt describing what to build or improve.");
  if (!llmProvider) return error("llm_provider is required", 400, "Supported: gemini, openai, claude, kimi");
  if (!llmApiKey) return error("llm_api_key is required", 400, "Your LLM API key. Used for this request only — never stored.");
  if (!isValidProvider(llmProvider)) return error("Invalid llm_provider", 400, "Supported: gemini, openai, claude, kimi");
  if (promptText.length > 10000) return error("Prompt too long. Max 10,000 characters.", 400);

  // Validate hackathon
  const { data: hackathon } = await supabaseAdmin
    .from("hackathons").select("*").eq("id", hackathonId).single();
  if (!hackathon) return notFound("Hackathon");

  if (!["open", "in_progress"].includes(hackathon.status)) {
    return error("Hackathon is not accepting prompts", 400, `Current status: ${hackathon.status}`);
  }

  // Validate team membership
  const { data: team } = await supabaseAdmin
    .from("teams").select("*").eq("id", teamId).eq("hackathon_id", hackathonId).single();
  if (!team) return notFound("Team");

  const { data: membership } = await supabaseAdmin
    .from("team_members").select("*").eq("team_id", teamId).eq("agent_id", agent.id).single();
  if (!membership) return error("You are not a member of this team", 403);

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

  // Build prompts
  const systemPrompt = buildSystemPrompt(
    hackathon.brief,
    agent.personality || "",
    agent.strategy || "",
    team.name,
    hackathon.challenge_type || "landing_page",
    previousCode,
    roundNumber,
  );

  const userPrompt = buildUserPrompt(promptText, roundNumber, previousCode);

  // Update hackathon status to in_progress if it's open
  if (hackathon.status === "open") {
    await supabaseAdmin.from("hackathons")
      .update({ status: "in_progress", updated_at: new Date().toISOString() })
      .eq("id", hackathonId);
  }

  // Generate code using agent's own key (key is NEVER stored/logged)
  let result;
  try {
    result = await generateCode({
      provider: llmProvider as LLMProvider,
      apiKey: llmApiKey,
      systemPrompt,
      userPrompt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "LLM call failed";
    return error(`Code generation failed: ${msg}`, 502, "Check your API key and provider.");
  }

  // Parse output into files
  const files = parseGeneratedFiles(result.text, hackathon.challenge_type || "landing_page");
  if (files.length === 0) {
    return error("LLM generated no usable code. Try a more specific prompt.", 422);
  }

  // Commit to GitHub
  let commitUrl = "";
  let folderUrl = "";
  const teamSlug = slugify(team.name);

  if (hackathon.github_repo) {
    try {
      const repoFullName = hackathon.github_repo.replace("https://github.com/", "");
      const commitResult = await commitRound(
        repoFullName,
        teamSlug,
        roundNumber,
        files,
        `🤖 ${agent.name} — Round ${roundNumber}`,
      );
      commitUrl = commitResult.commitUrl;
      folderUrl = commitResult.folderUrl;
    } catch (err) {
      // GitHub commit is best-effort, don't fail the whole request
      console.error("GitHub commit failed:", err);
    }
  }

  // Store round in DB
  const roundId = uuid();
  await supabaseAdmin.from("prompt_rounds").insert({
    id: roundId,
    team_id: teamId,
    hackathon_id: hackathonId,
    agent_id: agent.id,
    round_number: roundNumber,
    prompt_text: promptText,
    llm_provider: llmProvider,
    llm_model: result.model,
    files,
    commit_sha: commitUrl ? commitUrl.split("/").pop() : null,
    created_at: new Date().toISOString(),
  });

  // Also upsert into submissions (so judge + leaderboard stays compatible)
  const htmlFile = files.find(f => f.path === "demo.html") || files.find(f => f.path === "index.html" || f.path.endsWith(".html"));

  const { data: existingSub } = await supabaseAdmin
    .from("submissions")
    .select("id")
    .eq("team_id", teamId)
    .eq("hackathon_id", hackathonId)
    .single();

  if (existingSub) {
    await supabaseAdmin.from("submissions").update({
      html_content: htmlFile?.content || null,
      files,
      file_count: files.length,
      languages: [...new Set(files.map(f => detectLanguage(f.path)))],
      build_log: `Round ${roundNumber} by ${agent.name} via ${result.provider}/${result.model}`,
      status: "completed",
      completed_at: new Date().toISOString(),
    }).eq("id", existingSub.id);
  } else {
    await supabaseAdmin.from("submissions").insert({
      id: uuid(),
      team_id: teamId,
      hackathon_id: hackathonId,
      html_content: htmlFile?.content || null,
      files,
      file_count: files.length,
      languages: [...new Set(files.map(f => detectLanguage(f.path)))],
      project_type: hackathon.challenge_type || "landing_page",
      build_log: `Round ${roundNumber} by ${agent.name} via ${result.provider}/${result.model}`,
      status: "completed",
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });
  }

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
      provider: result.provider,
      model: result.model,
      file_count: files.length,
      prompt_length: promptText.length,
    },
  });

  return success({
    round: roundNumber,
    provider: result.provider,
    model: result.model,
    files: files.map(f => ({ path: f.path, content: f.content, size: f.content.length })),
    commit_url: commitUrl || null,
    github_folder: folderUrl || null,
    hint: roundNumber === 1
      ? "Review the generated code and send another prompt to iterate."
      : `This is round ${roundNumber}. Keep refining with more prompts, or trigger judging when ready.`,
  });
}

// ─── Prompt builders ───

function buildSystemPrompt(
  brief: string,
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

  return `You are building a project for team "${teamName}" in a hackathon competition.

AGENT PROFILE:
${personality ? `- Personality: ${personality}` : "- No personality defined"}
${strategy ? `- Strategy: ${strategy}` : "- No strategy defined"}

CHALLENGE BRIEF:
${brief}

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
  // Try multi-file format first
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

  // Fallback: extract HTML
  const html = extractHTML(text);
  if (html) {
    return [{ path: challengeType === "landing_page" ? "index.html" : "demo.html", content: html }];
  }

  // Fallback: code blocks
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
