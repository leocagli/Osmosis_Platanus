/**
 * Agent Webhook System — Push notifications to autonomous AI agents.
 *
 * Instead of polling GET /chat?since=..., agents register a webhook URL.
 * When they're @mentioned in Telegram, receive feedback, or a structured
 * command is sent, the platform POSTs to their webhook immediately.
 *
 * Flow:
 *   Telegram message arrives → webhook handler parses it →
 *   detect @mentions or /commands → resolve target agent →
 *   POST to agent's webhook_url with signed payload →
 *   agent processes and acts (iterate, review, deploy, etc.)
 *
 * Security:
 *   - Payloads are signed with HMAC-SHA256 using agent's webhook_secret
 *   - Agents verify via X-BuildersClaw-Signature header
 *   - Delivery retries with exponential backoff (max 3 attempts)
 *
 * Structured Commands (from Telegram):
 *   @agent_name iterate — agent should push another iteration
 *   @agent_name review — agent should review current code
 *   @agent_name build <brief> — agent should start building from brief
 *   @agent_name submit — agent should submit their work
 *   @agent_name status — agent should report progress
 *   (or just @agent_name <free text> — forwarded as-is)
 */

import crypto from "crypto";
import { supabaseAdmin } from "./supabase";
import { enqueueJob } from "./queue";

// ─── Types ───

export type WebhookEventType =
  | "mention"          // Someone @mentioned the agent
  | "command"          // Structured command detected
  | "feedback"         // Feedback reviewer posted a review
  | "push_notify"      // Another team member pushed code
  | "team_joined"      // New member joined the team
  | "deadline_warning" // Hackathon deadline approaching
  | "judging_result"   // Judging scores are in
  | "direct_message";  // Message in team chat directed at agent

export interface WebhookPayload {
  /** Unique delivery ID for idempotency */
  delivery_id: string;
  /** Event type */
  event: WebhookEventType;
  /** Target agent */
  agent_id: string;
  agent_name: string;
  /** When this happened */
  timestamp: string;
  /** The message/trigger */
  message: {
    from: string;
    from_type: "telegram" | "agent" | "system";
    text: string;
    /** Parsed command if structured format detected */
    command?: string | null;
    /** Command arguments */
    args?: Record<string, string> | null;
    /** Original message ID (for threading/replies) */
    message_id?: string | null;
  };
  /** Full context so the agent can act immediately */
  context: {
    hackathon_id: string | null;
    hackathon_title?: string | null;
    hackathon_brief?: string | null;
    team_id: string | null;
    team_name?: string | null;
    agent_role?: string | null;
    repo_url?: string | null;
  };
  /** Chat API endpoint for the agent to respond */
  reply_endpoint?: string | null;
}

export interface WebhookConfig {
  agent_id: string;
  webhook_url: string;
  webhook_secret: string;
  /** Which events to receive (empty = all) */
  events: WebhookEventType[];
  /** Is this webhook active? */
  active: boolean;
  /** Last successful delivery */
  last_delivery_at: string | null;
  /** Consecutive failures */
  failure_count: number;
  created_at: string;
  updated_at: string;
}

// ─── Known Commands ───

const KNOWN_COMMANDS: Record<string, {
  description: string;
  requiresArgs: boolean;
}> = {
  iterate:  { description: "Push another iteration based on feedback", requiresArgs: false },
  review:   { description: "Review current code and provide feedback", requiresArgs: false },
  build:    { description: "Start building from the hackathon brief", requiresArgs: false },
  submit:   { description: "Submit current work for judging", requiresArgs: false },
  status:   { description: "Report current progress", requiresArgs: false },
  fix:      { description: "Fix a specific issue", requiresArgs: true },
  deploy:   { description: "Deploy the current build", requiresArgs: false },
  test:     { description: "Run tests and report results", requiresArgs: false },
  help:     { description: "List available commands", requiresArgs: false },
};

// ─── Mention Detection ───

/**
 * Extract @mentions from a message text.
 * Returns array of mentioned usernames (lowercase, without @).
 *
 * Supports:
 *   @agent_name         — standard mention
 *   @agent_name iterate — mention + command
 */
export function extractMentions(text: string): string[] {
  const mentionRegex = /@([a-zA-Z0-9_]+)/g;
  const mentions: string[] = [];
  let match;
  while ((match = mentionRegex.exec(text)) !== null) {
    mentions.push(match[1].toLowerCase());
  }
  return [...new Set(mentions)]; // dedupe
}

/**
 * Parse a structured command from text after an @mention.
 *
 * Input:  "@my_agent iterate"
 * Output: { command: "iterate", args: {} }
 *
 * Input:  "@my_agent fix the login bug on mobile"
 * Output: { command: "fix", args: { detail: "the login bug on mobile" } }
 *
 * Input:  "@my_agent hey can you check this?"
 * Output: { command: null, args: null }  (free-form text, no command)
 */
export function parseCommand(
  text: string,
  agentUsername: string,
): { command: string | null; args: Record<string, string> | null } {
  // Find the mention and extract everything after it
  const mentionPattern = new RegExp(`@${agentUsername}\\s*`, "i");
  const afterMention = text.replace(mentionPattern, "").trim();

  if (!afterMention) {
    return { command: null, args: null };
  }

  // Check if the first word is a known command
  const words = afterMention.split(/\s+/);
  const firstWord = words[0].toLowerCase();

  if (KNOWN_COMMANDS[firstWord]) {
    const rest = words.slice(1).join(" ").trim();
    const args: Record<string, string> = {};
    if (rest) args.detail = rest;
    return { command: firstWord, args: Object.keys(args).length > 0 ? args : null };
  }

  // Not a known command — return as free-form
  return { command: null, args: null };
}

// ─── Webhook Config Management ───

/**
 * Register or update a webhook for an agent.
 * Generates a webhook_secret automatically if not provided.
 */
export async function upsertWebhookConfig(
  agentId: string,
  webhookUrl: string,
  events?: WebhookEventType[],
): Promise<{ config: WebhookConfig; secret: string; isNew: boolean }> {
  // Validate URL
  try {
    const url = new URL(webhookUrl);
    if (!["https:", "http:"].includes(url.protocol)) {
      throw new Error("Webhook URL must use HTTPS (or HTTP for localhost)");
    }
    // Only allow HTTP for localhost/dev
    if (url.protocol === "http:" && !["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname)) {
      throw new Error("HTTP webhooks only allowed for localhost. Use HTTPS for production.");
    }
  } catch (err) {
    throw new Error(`Invalid webhook URL: ${(err as Error).message}`);
  }

  // Check if config already exists
  const { data: existing } = await supabaseAdmin
    .from("agent_webhooks")
    .select("*")
    .eq("agent_id", agentId)
    .single();

  const secret = existing?.webhook_secret || crypto.randomBytes(32).toString("hex");

  if (existing) {
    // Update
    const { data: updated, error } = await supabaseAdmin
      .from("agent_webhooks")
      .update({
        webhook_url: webhookUrl,
        events: events || existing.events || [],
        active: true,
        failure_count: 0, // Reset on re-register
        updated_at: new Date().toISOString(),
      })
      .eq("agent_id", agentId)
      .select("*")
      .single();

    if (error) throw new Error(`Failed to update webhook: ${error.message}`);
    return { config: updated as WebhookConfig, secret, isNew: false };
  }

  // Create new
  const { data: created, error } = await supabaseAdmin
    .from("agent_webhooks")
    .insert({
      agent_id: agentId,
      webhook_url: webhookUrl,
      webhook_secret: secret,
      events: events || [],
      active: true,
      failure_count: 0,
    })
    .select("*")
    .single();

  if (error) throw new Error(`Failed to create webhook: ${error.message}`);
  return { config: created as WebhookConfig, secret, isNew: true };
}

/**
 * Get webhook config for an agent.
 */
export async function getWebhookConfig(agentId: string): Promise<WebhookConfig | null> {
  const { data } = await supabaseAdmin
    .from("agent_webhooks")
    .select("*")
    .eq("agent_id", agentId)
    .single();

  return data as WebhookConfig | null;
}

/**
 * Deactivate an agent's webhook.
 */
export async function deactivateWebhook(agentId: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from("agent_webhooks")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("agent_id", agentId);

  return !error;
}

// ─── Webhook Delivery ───

/**
 * Sign a payload with HMAC-SHA256.
 */
function signPayload(payload: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(payload, "utf8")
    .digest("hex");
}

/**
 * Deliver a webhook payload to an agent.
 * Retries up to 3 times with exponential backoff.
 */
async function deliverWebhook(
  config: WebhookConfig,
  payload: WebhookPayload,
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  const body = JSON.stringify(payload);
  const signature = signPayload(body, config.webhook_secret);
  const retries = [0, 2000, 5000]; // immediate, 2s, 5s

  for (let attempt = 0; attempt < retries.length; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, retries[attempt]));
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000); // 10s timeout

      const resp = await fetch(config.webhook_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-BuildersClaw-Signature": `sha256=${signature}`,
          "X-BuildersClaw-Event": payload.event,
          "X-BuildersClaw-Delivery": payload.delivery_id,
          "User-Agent": "BuildersClaw-Webhook/1.0",
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (resp.ok) {
        // Success — reset failure count
        await supabaseAdmin
          .from("agent_webhooks")
          .update({
            last_delivery_at: new Date().toISOString(),
            failure_count: 0,
            updated_at: new Date().toISOString(),
          })
          .eq("agent_id", config.agent_id);

        console.log(`[WEBHOOK] ✅ Delivered ${payload.event} to ${config.agent_id} (attempt ${attempt + 1})`);
        return { success: true, statusCode: resp.status };
      }

      console.warn(`[WEBHOOK] ⚠️ ${resp.status} from ${config.webhook_url} (attempt ${attempt + 1})`);

      // Don't retry 4xx errors (client error, won't change)
      if (resp.status >= 400 && resp.status < 500) {
        return { success: false, statusCode: resp.status, error: `HTTP ${resp.status}` };
      }
    } catch (err) {
      console.warn(`[WEBHOOK] ⚠️ Delivery failed (attempt ${attempt + 1}):`, (err as Error).message);
    }
  }

  // All retries failed — increment failure counter
  const { data: current } = await supabaseAdmin
    .from("agent_webhooks")
    .select("failure_count")
    .eq("agent_id", config.agent_id)
    .single();

  const newCount = (current?.failure_count || 0) + 1;

  // Auto-deactivate after 10 consecutive failures
  const updates: Record<string, unknown> = {
    failure_count: newCount,
    updated_at: new Date().toISOString(),
  };

  if (newCount >= 10) {
    updates.active = false;
    console.error(`[WEBHOOK] ❌ Auto-deactivated webhook for ${config.agent_id} after ${newCount} consecutive failures`);
  }

  await supabaseAdmin
    .from("agent_webhooks")
    .update(updates)
    .eq("agent_id", config.agent_id);

  return { success: false, error: `All ${retries.length} delivery attempts failed` };
}

export async function dispatchQueuedWebhookDelivery(deliveryId: string): Promise<boolean> {
  const { data: row, error } = await supabaseAdmin
    .from("webhook_deliveries")
    .select("delivery_id, agent_id, payload, attempts")
    .eq("delivery_id", deliveryId)
    .single();

  if (error || !row?.payload) throw new Error(error?.message || "Webhook delivery payload not found");

  const payload = row.payload as WebhookPayload;
  const config = await getWebhookConfig(payload.agent_id);
  if (!config || !config.active) {
    await logDelivery(payload, "failed");
    return false;
  }

  const result = await deliverWebhook(config, payload);
  await supabaseAdmin
    .from("webhook_deliveries")
    .update({ attempts: (row.attempts || 0) + 1, updated_at: new Date().toISOString() })
    .eq("delivery_id", deliveryId);
  await logDelivery(payload, result.success ? "delivered" : "failed");

  if (!result.success && (row.attempts || 0) < 2) {
    await enqueueJob({
      type: "agent_webhook.deliver",
      payload: { delivery_id: deliveryId },
      runAt: new Date(Date.now() + 60_000 * ((row.attempts || 0) + 1)),
      maxAttempts: 3,
    });
  }

  return result.success;
}

// ─── High-Level Dispatch ───

/**
 * Look up agents mentioned in a message and dispatch webhooks to them.
 * Called from the Telegram webhook handler.
 *
 * Returns list of agents that were notified.
 */
export async function dispatchMentionWebhooks(opts: {
  messageText: string;
  fromName: string;
  fromType: "telegram" | "agent" | "system";
  teamId: string;
  hackathonId: string;
  telegramMessageId?: number;
}): Promise<string[]> {
  const mentions = extractMentions(opts.messageText);
  if (mentions.length === 0) return [];

  // Resolve mentioned agents by name
  const { data: agents } = await supabaseAdmin
    .from("agents")
    .select("id, name, strategy")
    .in("name", mentions);

  if (!agents || agents.length === 0) {
    // Also try matching by telegram_username stored in strategy
    const { data: allAgents } = await supabaseAdmin
      .from("agents")
      .select("id, name, strategy")
      .not("strategy", "is", null);

    const matched = (allAgents || []).filter((a) => {
      try {
        const s = JSON.parse(a.strategy || "{}");
        return mentions.includes((s.telegram_username || "").toLowerCase());
      } catch { return false; }
    });

    if (matched.length === 0) return [];
    return dispatchToAgents(matched, opts);
  }

  return dispatchToAgents(agents, opts);
}

/**
 * Dispatch webhook to a specific agent for a specific event.
 * Used by platform internals (feedback, push notifications, etc.)
 */
export async function dispatchEventWebhook(opts: {
  agentId: string;
  event: WebhookEventType;
  message: WebhookPayload["message"];
  teamId: string | null;
  hackathonId: string | null;
}): Promise<boolean> {
  const config = await getWebhookConfig(opts.agentId);
  if (!config || !config.active) return false;

  // Check event filter
  if (config.events.length > 0 && !config.events.includes(opts.event)) return false;

  // Get agent info
  const { data: agent } = await supabaseAdmin
    .from("agents")
    .select("name")
    .eq("id", opts.agentId)
    .single();

  if (!agent) return false;

  // Build context
  const context = await buildContext(opts.teamId, opts.hackathonId, opts.agentId);

  const payload: WebhookPayload = {
    delivery_id: crypto.randomUUID(),
    event: opts.event,
    agent_id: opts.agentId,
    agent_name: agent.name,
    timestamp: new Date().toISOString(),
    message: opts.message,
    context,
    reply_endpoint: opts.teamId && opts.hackathonId
      ? `/api/v1/hackathons/${opts.hackathonId}/teams/${opts.teamId}/chat`
      : null,
  };

  // Log delivery attempt
  await logDelivery(payload, "pending");

  await enqueueJob({ type: "agent_webhook.deliver", payload: { delivery_id: payload.delivery_id }, maxAttempts: 3 });
  return true;
}

// ─── Internal Helpers ───

async function dispatchToAgents(
  agents: Array<{ id: string; name: string; strategy: string | null }>,
  opts: {
    messageText: string;
    fromName: string;
    fromType: "telegram" | "agent" | "system";
    teamId: string;
    hackathonId: string;
    telegramMessageId?: number;
  },
): Promise<string[]> {
  const notified: string[] = [];

  for (const agent of agents) {
    const config = await getWebhookConfig(agent.id);
    if (!config || !config.active) continue;

    // Check event filter
    if (config.events.length > 0 && !config.events.includes("mention")) continue;

    // Parse command from the mention
    const { command, args } = parseCommand(opts.messageText, agent.name);

    // Build context
    const context = await buildContext(opts.teamId, opts.hackathonId, agent.id);

    const payload: WebhookPayload = {
      delivery_id: crypto.randomUUID(),
      event: command ? "command" : "mention",
      agent_id: agent.id,
      agent_name: agent.name,
      timestamp: new Date().toISOString(),
      message: {
        from: opts.fromName,
        from_type: opts.fromType,
        text: opts.messageText,
        command,
        args,
        message_id: opts.telegramMessageId?.toString() || null,
      },
      context,
      reply_endpoint: `/api/v1/hackathons/${opts.hackathonId}/teams/${opts.teamId}/chat`,
    };

    await logDelivery(payload, "pending");
    await enqueueJob({ type: "agent_webhook.deliver", payload: { delivery_id: payload.delivery_id }, maxAttempts: 3 });
    notified.push(agent.name);
  }

  return notified;
}

/**
 * Build rich context for the webhook payload.
 * Includes hackathon brief, team info, and agent's role.
 */
async function buildContext(
  teamId: string | null,
  hackathonId: string | null,
  agentId: string,
): Promise<WebhookPayload["context"]> {
  const context: WebhookPayload["context"] = {
    hackathon_id: hackathonId,
    team_id: teamId,
  };

  if (hackathonId) {
    const { data: hackathon } = await supabaseAdmin
      .from("hackathons")
      .select("title, brief")
      .eq("id", hackathonId)
      .single();

    if (hackathon) {
      context.hackathon_title = hackathon.title;
      context.hackathon_brief = hackathon.brief;
    }
  }

  if (teamId) {
    const { data: team } = await supabaseAdmin
      .from("teams")
      .select("name")
      .eq("id", teamId)
      .single();

    if (team) context.team_name = team.name;

    // Get agent's role in this team
    const { data: membership } = await supabaseAdmin
      .from("team_members")
      .select("role, revenue_share_pct")
      .eq("team_id", teamId)
      .eq("agent_id", agentId)
      .single();

    if (membership) context.agent_role = membership.role;

    // Get repo URL from latest submission
    const { data: submission } = await supabaseAdmin
      .from("submissions")
      .select("repo_url, project_url")
      .eq("team_id", teamId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (submission) {
      context.repo_url = submission.repo_url || submission.project_url || null;
    }
  }

  return context;
}

/**
 * Log webhook delivery to the database for debugging and audit.
 */
async function logDelivery(
  payload: WebhookPayload,
  status: "pending" | "delivered" | "failed",
): Promise<void> {
  try {
    await supabaseAdmin
      .from("webhook_deliveries")
      .upsert({
        delivery_id: payload.delivery_id,
        agent_id: payload.agent_id,
        event: payload.event,
        status,
        payload,
        payload_summary: {
          event: payload.event,
          command: payload.message.command,
          from: payload.message.from,
          team_id: payload.context.team_id,
          hackathon_id: payload.context.hackathon_id,
        },
        updated_at: new Date().toISOString(),
      }, { onConflict: "delivery_id" });
  } catch (err) {
    // Non-critical — don't let logging break delivery
    console.warn("[WEBHOOK] Log failed:", (err as Error).message);
  }
}

// ─── Public Helpers ───

/**
 * Get delivery logs for an agent (for debugging).
 */
export async function getDeliveryLogs(
  agentId: string,
  limit = 20,
): Promise<Array<{
  delivery_id: string;
  event: string;
  status: string;
  payload_summary: unknown;
  updated_at: string;
}>> {
  const { data } = await supabaseAdmin
    .from("webhook_deliveries")
    .select("delivery_id, event, status, payload_summary, updated_at")
    .eq("agent_id", agentId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  return data || [];
}

/**
 * List all known commands and their descriptions.
 * Useful for agents to discover what commands they can receive.
 */
export function getKnownCommands(): Record<string, { description: string; requiresArgs: boolean }> {
  return { ...KNOWN_COMMANDS };
}
