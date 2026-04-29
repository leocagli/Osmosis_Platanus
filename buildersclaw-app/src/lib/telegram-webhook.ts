/**
 * Telegram Webhook Handler
 *
 * Receives incoming messages from Telegram and bridges them to team_chat DB
 * so agents can read them via GET /api/v1/.../teams/:id/chat
 *
 * Setup is automatic:
 *   On first deploy, call POST /api/v1/telegram/setup to register the webhook.
 *   Or set TELEGRAM_WEBHOOK_SECRET and it auto-registers on first boot.
 *
 * Flow:
 *   Telegram → POST /api/v1/telegram/webhook → parse message →
 *   lookup team by thread_id → save to team_chat DB
 */

import { supabaseAdmin } from "./supabase";
import { postChatMessage } from "./chat";

const BOT_TOKEN = () => process.env.TELEGRAM_BOT_TOKEN || "";
const WEBHOOK_SECRET = () => process.env.TELEGRAM_WEBHOOK_SECRET || "buildersclaw_tg_hook";
const FORUM_CHAT_ID = () => process.env.TELEGRAM_FORUM_CHAT_ID || process.env.TELEGRAM_CHAT_ID || "";

// ─── Types ───

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramMessage {
  message_id: number;
  message_thread_id?: number;
  from?: {
    id: number;
    is_bot: boolean;
    first_name: string;
    last_name?: string;
    username?: string;
  };
  chat: {
    id: number;
    type: string;
  };
  date: number;
  text?: string;
  reply_to_message?: TelegramMessage;
}

// ─── Webhook Processing ───

/**
 * Process an incoming Telegram update.
 * Called by the webhook API route.
 */
export async function processTelegramUpdate(update: TelegramUpdate): Promise<void> {
  const msg = update.message;
  if (!msg || !msg.text) return;

  // Ignore bot's own messages
  if (msg.from?.is_bot) return;

  // Only process messages from our forum supergroup
  const forumId = FORUM_CHAT_ID();
  if (forumId && String(msg.chat.id) !== String(forumId)) return;

  // Must be in a topic (thread)
  const threadId = msg.message_thread_id;
  if (!threadId) return; // General topic messages — skip

  // Find which team this topic belongs to
  const { data: team } = await supabaseAdmin
    .from("teams")
    .select("id, hackathon_id, name")
    .eq("telegram_chat_id", String(threadId))
    .single();

  if (!team) {
    console.log(`[TG-WEBHOOK] No team found for thread ${threadId}`);
    return;
  }

  // Build sender name
  const senderName = [msg.from?.first_name, msg.from?.last_name]
    .filter(Boolean)
    .join(" ") || msg.from?.username || "Unknown";

  // Save to team_chat
  await postChatMessage({
    teamId: team.id,
    hackathonId: team.hackathon_id,
    senderType: "telegram",
    senderId: null, // Not an agent — external Telegram user
    senderName: `📱 ${senderName}`,
    messageType: "text",
    content: msg.text,
    metadata: {
      telegram_user_id: msg.from?.id,
      telegram_username: msg.from?.username || null,
      telegram_message_id: msg.message_id,
    },
  });

  console.log(`[TG-WEBHOOK] Saved message from ${senderName} to team ${team.name}`);
}

/**
 * Validate the webhook secret token from Telegram.
 */
export function validateWebhookSecret(secretHeader: string | null): boolean {
  const expected = WEBHOOK_SECRET();
  if (!expected || !secretHeader) return false;
  return secretHeader === expected;
}

// ─── Webhook Registration ───

/**
 * Register the webhook URL with Telegram.
 * Call this once after deploying (or on setup endpoint).
 */
export async function registerWebhook(baseUrl: string): Promise<{
  ok: boolean;
  description?: string;
}> {
  const token = BOT_TOKEN();
  if (!token) return { ok: false, description: "No TELEGRAM_BOT_TOKEN" };

  const webhookUrl = `${baseUrl}/api/v1/telegram/webhook`;
  const secret = WEBHOOK_SECRET();

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: secret,
        allowed_updates: ["message"],
        drop_pending_updates: true,
      }),
    });

    const data = await res.json();
    console.log("[TELEGRAM] Webhook registered:", data.ok ? webhookUrl : data.description);
    return data;
  } catch (err) {
    console.error("[TELEGRAM] Webhook registration failed:", err);
    return { ok: false, description: String(err) };
  }
}

/**
 * Get current webhook info from Telegram.
 */
export async function getWebhookInfo(): Promise<unknown> {
  const token = BOT_TOKEN();
  if (!token) return { error: "No token" };

  const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  return res.json();
}
