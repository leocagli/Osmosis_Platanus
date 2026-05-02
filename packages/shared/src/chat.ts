/**
 * Team Chat — bridged communication between AI agents and Telegram.
 *
 * Agents don't have Telegram accounts. The platform bridges:
 *   Agent → POST /api/v1/teams/:id/chat → Bot posts in Telegram topic
 *   Telegram webhook → stored in DB → Agent polls GET /api/v1/teams/:id/chat
 *
 * This module handles the DB layer and Telegram bridging logic.
 */

import { and, asc, desc, eq, gt, lt } from "drizzle-orm";
import { getDb } from "./db";
import { teamChat, type TeamChatRow } from "./db/schema";

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

function toChatMessage(row: TeamChatRow): ChatMessage {
  return {
    id: row.id,
    team_id: row.teamId,
    hackathon_id: row.hackathonId,
    sender_type: row.senderType,
    sender_id: row.senderId,
    sender_name: row.senderName,
    message_type: row.messageType,
    content: row.content,
    metadata: row.metadata,
    telegram_message_id: row.telegramMessageId,
    created_at: row.createdAt,
  };
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
  try {
    const [data] = await getDb()
      .insert(teamChat)
      .values({
        teamId: opts.teamId,
        hackathonId: opts.hackathonId,
        senderType: opts.senderType,
        senderId: opts.senderId,
        senderName: opts.senderName,
        messageType: opts.messageType,
        content: opts.content,
        metadata: opts.metadata || null,
      })
      .returning();

    return data ? toChatMessage(data) : null;
  } catch (error) {
    console.error("[CHAT] Insert failed:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * Get chat messages for a team, with pagination.
 */
export async function getChatMessages(opts: {
  teamId: string;
  limit?: number;
  before?: string; // ISO timestamp for cursor pagination
}): Promise<ChatMessage[]> {
  try {
    const rows = await getDb()
      .select()
      .from(teamChat)
      .where(opts.before ? and(eq(teamChat.teamId, opts.teamId), lt(teamChat.createdAt, opts.before)) : eq(teamChat.teamId, opts.teamId))
      .orderBy(desc(teamChat.createdAt))
      .limit(opts.limit || 50);

    return rows.map(toChatMessage).reverse();
  } catch (error) {
    console.error("[CHAT] Fetch failed:", error instanceof Error ? error.message : String(error));
    return [];
  }
}

/**
 * Get messages since a timestamp (for polling).
 */
export async function getChatMessagesSince(opts: {
  teamId: string;
  since: string; // ISO timestamp
}): Promise<ChatMessage[]> {
  try {
    const rows = await getDb()
      .select()
      .from(teamChat)
      .where(and(eq(teamChat.teamId, opts.teamId), gt(teamChat.createdAt, opts.since)))
      .orderBy(asc(teamChat.createdAt))
      .limit(100);

    return rows.map(toChatMessage);
  } catch (error) {
    console.error("[CHAT] Poll failed:", error instanceof Error ? error.message : String(error));
    return [];
  }
}
