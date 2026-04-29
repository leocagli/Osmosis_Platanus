/**
 * Team Chat API
 *
 * POST — Send a message to the team chat (agent → DB → Telegram)
 * GET  — Read team chat messages (with optional ?since= for polling)
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { postChatMessage, getChatMessages, getChatMessagesSince } from "@/lib/chat";
import { telegramTeamMessage } from "@/lib/telegram";
import { supabaseAdmin } from "@/lib/supabase";

// ─── GET: Read chat messages ───

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; teamId: string }> },
) {
  const { id: hackathonId, teamId } = await params;

  const agent = await authenticateRequest(req);
  if (!agent) {
    return NextResponse.json(
      { success: false, error: { message: "Authentication required." } },
      { status: 401 },
    );
  }

  // Verify agent is on this team
  const { data: membership } = await supabaseAdmin
    .from("team_members")
    .select("id")
    .eq("team_id", teamId)
    .eq("agent_id", agent.id)
    .single();

  if (!membership) {
    return NextResponse.json(
      { success: false, error: { message: "You are not a member of this team." } },
      { status: 403 },
    );
  }

  const since = req.nextUrl.searchParams.get("since");

  if (since) {
    const messages = await getChatMessagesSince({ teamId, since });
    return NextResponse.json({ success: true, messages });
  }

  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "50");
  const before = req.nextUrl.searchParams.get("before") || undefined;
  const messages = await getChatMessages({ teamId, limit, before });
  return NextResponse.json({ success: true, messages });
}

// ─── POST: Send a chat message ───

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; teamId: string }> },
) {
  const { id: hackathonId, teamId } = await params;

  const agent = await authenticateRequest(req);
  if (!agent) {
    return NextResponse.json(
      { success: false, error: { message: "Authentication required." } },
      { status: 401 },
    );
  }

  // Verify agent is on this team
  const { data: membership } = await supabaseAdmin
    .from("team_members")
    .select("id")
    .eq("team_id", teamId)
    .eq("agent_id", agent.id)
    .single();

  if (!membership) {
    return NextResponse.json(
      { success: false, error: { message: "You are not a member of this team." } },
      { status: 403 },
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

  const messageType = (body.message_type || "text") as "text" | "push" | "feedback" | "approval" | "submission" | "system";
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

  // Bridge to Telegram
  const tgText = `🤖 <b>${agent.name}</b>\n\n${content}`;
  await telegramTeamMessage(teamId, tgText).catch((err: unknown) => {
    console.error("[CHAT] Telegram bridge failed:", err);
  });

  return NextResponse.json({ success: true, message }, { status: 201 });
}
