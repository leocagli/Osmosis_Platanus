/**
 * Team Chat API
 *
 * POST — Send a message to the team chat (agent → DB → Telegram)
 * GET  — Read team chat messages (with optional ?since= for polling)
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { authenticateRequest } from "@buildersclaw/shared/auth";
import { postChatMessage, getChatMessages, getChatMessagesSince } from "@buildersclaw/shared/chat";
import { getDb, schema } from "@buildersclaw/shared/db";
import { telegramTeamMessage } from "@buildersclaw/shared/telegram";
import { checkRateLimit, isValidUUID, CHAT_RATE_LIMIT_PER_MIN } from "@buildersclaw/shared/validation";
import { escapeHtml } from "@/lib/sanitize";

// ─── GET: Read chat messages ───

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; teamId: string }> },
) {
  const { id: hackathonId, teamId } = await params;

  // ── Validate ID formats ──
  if (!isValidUUID(hackathonId) || !isValidUUID(teamId)) {
    return NextResponse.json(
      { success: false, error: { message: "Invalid ID format" } },
      { status: 400 },
    );
  }

  const agent = await authenticateRequest(req);
  if (!agent) {
    return NextResponse.json(
      { success: false, error: { message: "Authentication required." } },
      { status: 401 },
    );
  }

  // Verify team belongs to this hackathon
  const [team] = await getDb()
    .select({ id: schema.teams.id })
    .from(schema.teams)
    .where(and(eq(schema.teams.id, teamId), eq(schema.teams.hackathonId, hackathonId)))
    .limit(1);

  if (!team) {
    return NextResponse.json(
      { success: false, error: { message: "Team not found in this hackathon." } },
      { status: 404 },
    );
  }

  // Verify agent is on this team
  const [membership] = await getDb()
    .select({ id: schema.teamMembers.id })
    .from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.agentId, agent.id)))
    .limit(1);

  if (!membership) {
    return NextResponse.json(
      { success: false, error: { message: "You are not a member of this team." } },
      { status: 403 },
    );
  }

  const since = req.nextUrl.searchParams.get("since");

  if (since) {
    // ── SECURITY: Validate since parameter is a valid ISO date ──
    const sinceDate = new Date(since);
    if (isNaN(sinceDate.getTime())) {
      return NextResponse.json(
        { success: false, error: { message: "Invalid 'since' parameter. Must be ISO 8601 date string." } },
        { status: 400 },
      );
    }
    const messages = await getChatMessagesSince({ teamId, since: sinceDate.toISOString() });
    return NextResponse.json({ success: true, messages });
  }

  // ── SECURITY: Clamp limit to prevent abuse ──
  const rawLimit = parseInt(req.nextUrl.searchParams.get("limit") || "50");
  const limit = Math.min(Math.max(1, isNaN(rawLimit) ? 50 : rawLimit), 200);
  const before = req.nextUrl.searchParams.get("before") || undefined;
  
  // ── SECURITY: Validate before parameter if provided ──
  if (before) {
    const beforeDate = new Date(before);
    if (isNaN(beforeDate.getTime())) {
      return NextResponse.json(
        { success: false, error: { message: "Invalid 'before' parameter. Must be ISO 8601 date string." } },
        { status: 400 },
      );
    }
  }
  
  const messages = await getChatMessages({ teamId, limit, before });
  return NextResponse.json({ success: true, messages });
}

// ─── POST: Send a chat message ───

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; teamId: string }> },
) {
  const { id: hackathonId, teamId } = await params;

  // ── Validate ID formats ──
  if (!isValidUUID(hackathonId) || !isValidUUID(teamId)) {
    return NextResponse.json(
      { success: false, error: { message: "Invalid ID format" } },
      { status: 400 },
    );
  }

  const agent = await authenticateRequest(req);
  if (!agent) {
    return NextResponse.json(
      { success: false, error: { message: "Authentication required." } },
      { status: 401 },
    );
  }

  // Verify team belongs to this hackathon
  const [team] = await getDb()
    .select({ id: schema.teams.id })
    .from(schema.teams)
    .where(and(eq(schema.teams.id, teamId), eq(schema.teams.hackathonId, hackathonId)))
    .limit(1);

  if (!team) {
    return NextResponse.json(
      { success: false, error: { message: "Team not found in this hackathon." } },
      { status: 404 },
    );
  }

  // Verify agent is on this team
  const [membership] = await getDb()
    .select({ id: schema.teamMembers.id })
    .from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.agentId, agent.id)))
    .limit(1);

  if (!membership) {
    return NextResponse.json(
      { success: false, error: { message: "You are not a member of this team." } },
      { status: 403 },
    );
  }

  // ── Rate limit: prevent chat spam ──
  const rateCheck = checkRateLimit(`chat:${agent.id}:${teamId}`, CHAT_RATE_LIMIT_PER_MIN, 60_000);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { success: false, error: { message: `Too many messages. Limit: ${CHAT_RATE_LIMIT_PER_MIN}/minute. Try again shortly.` } },
      { status: 429 },
    );
  }

  let body: { content?: string; message_type?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { message: "Invalid JSON body." } },
      { status: 400 },
    );
  }

  const content = body.content?.trim();
  if (!content) {
    return NextResponse.json(
      { success: false, error: { message: "content is required." } },
      { status: 400 },
    );
  }

  if (content.length > 4000) {
    return NextResponse.json(
      { success: false, error: { message: "Message too long. Max 4000 characters." } },
      { status: 400 },
    );
  }

  // ── SECURITY: Agents cannot send "system" messages — that's platform-only ──
  const rawMessageType = body.message_type || "text";
  const agentAllowedTypes = ["text", "push", "feedback", "approval"];
  const systemOnlyTypes = ["submission", "system"];
  
  if (systemOnlyTypes.includes(rawMessageType)) {
    return NextResponse.json(
      { success: false, error: { message: `Message type "${rawMessageType}" is reserved for the platform. Agents can use: ${agentAllowedTypes.join(", ")}` } },
      { status: 403 },
    );
  }

  const messageType = rawMessageType as "text" | "push" | "feedback" | "approval" | "submission" | "system";
  const validTypes = ["text", "push", "feedback", "approval", "submission", "system"];
  if (!validTypes.includes(messageType)) {
    return NextResponse.json(
      { success: false, error: { message: `Invalid message_type. Must be one of: ${validTypes.join(", ")}` } },
      { status: 400 },
    );
  }

  // Save to DB
  const message = await postChatMessage({
    teamId,
    hackathonId,
    senderType: "agent",
    senderId: agent.id,
    senderName: agent.name,
    messageType,
    content,
  });

  if (!message) {
    return NextResponse.json(
      { success: false, error: { message: "Failed to save message." } },
      { status: 500 },
    );
  }

  // Bridge to Telegram (sanitize HTML to prevent injection)
  const safeName = escapeHtml(agent.name);
  const safeContent = escapeHtml(content);
  const tgText = `🤖 <b>${safeName}</b>\n\n${safeContent}`;
  await telegramTeamMessage(teamId, tgText).catch((err: unknown) => {
    console.error("[CHAT] Telegram bridge failed:", err);
  });

  return NextResponse.json({ success: true, message }, { status: 201 });
}
