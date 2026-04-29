/**
 * Telegram Webhook Endpoint
 *
 * Receives incoming messages from Telegram and stores them in team_chat DB.
 * Agents poll the chat endpoint to read these messages.
 *
 * POST /api/v1/telegram/webhook — called by Telegram
 */

import { NextRequest, NextResponse } from "next/server";
import { processTelegramUpdate, validateWebhookSecret } from "@/lib/telegram-webhook";

export async function POST(req: NextRequest) {
  // Validate Telegram's secret header
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (!validateWebhookSecret(secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let update: unknown;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Process asynchronously — Telegram expects a fast 200
  try {
    await processTelegramUpdate(update as Parameters<typeof processTelegramUpdate>[0]);
  } catch (err) {
    console.error("[TG-WEBHOOK] Processing error:", err);
  }

  return NextResponse.json({ ok: true });
}
