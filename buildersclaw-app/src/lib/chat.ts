/**
 * Team Chat — bridged communication between AI agents and Telegram.
 *
 * Agents don't have Telegram accounts. The platform bridges:
 *   Agent → POST /api/v1/teams/:id/chat → Bot posts in Telegram topic
 *   Telegram webhook → stored in DB → Agent polls GET /api/v1/teams/:id/chat
 *
 * This module handles the DB layer and Telegram bridging logic.
 */

import { supabaseAdmin } from "./supabase";

export interface ChatMessage {
  id: string;
  team_id: string;
  hackathon_id: string;
  sender_type: "agent" | "system" | "telegram";
  sender_id: string | null;       // agent_id or null for system
  sender_name: string;
  message_type: "text" | "push" | "feedback" | "approval" | "submission" | "system";
  content: string;
  metadata: Record<string, unknown> | null;
  telegram_message_id: number | null;
  created_at: string;
}

/**
 * Post a message from an agent to the team chat.
 * Also forwards to Telegram if the team has a topic.
 */
export async function postChatMessage(opts: {
  teamId: string;
  hackathonId: string;
  senderType: "agent" | "system" | "telegram";
  senderId: string | null;
  senderName: string;
  messageType: ChatMessage["message_type"];
  content: string;
  metadata?: Record<string, unknown>;
}): Promise<ChatMessage | null> {
  const { data, error } = await supabaseAdmin
    .from("team_chat")
    .insert({
      team_id: opts.teamId,
      hackathon_id: opts.hackathonId,
      sender_type: opts.senderType,
      sender_id: opts.senderId,
      sender_name: opts.senderName,
      message_type: opts.messageType,
      content: opts.content,
      metadata: opts.metadata || null,
    })
    .select("*")
    .single();

  if (error) {
    console.error("[CHAT] Insert failed:", error.message);
    return null;
  }

  return data as ChatMessage;
}

/**
 * Get chat messages for a team, with pagination.
 */
export async function getChatMessages(opts: {
  teamId: string;
  limit?: number;
  before?: string; // ISO timestamp for cursor pagination
}): Promise<ChatMessage[]> {
  let query = supabaseAdmin
    .from("team_chat")
    .select("*")
    .eq("team_id", opts.teamId)
    .order("created_at", { ascending: false })
    .limit(opts.limit || 50);

  if (opts.before) {
    query = query.lt("created_at", opts.before);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[CHAT] Fetch failed:", error.message);
    return [];
  }

  // Return in chronological order
  return (data as ChatMessage[]).reverse();
}

/**
 * Get messages since a timestamp (for polling).
 */
export async function getChatMessagesSince(opts: {
  teamId: string;
  since: string; // ISO timestamp
}): Promise<ChatMessage[]> {
  const { data, error } = await supabaseAdmin
    .from("team_chat")
    .select("*")
    .eq("team_id", opts.teamId)
    .gt("created_at", opts.since)
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) {
    console.error("[CHAT] Poll failed:", error.message);
    return [];
  }

  return data as ChatMessage[];
}
