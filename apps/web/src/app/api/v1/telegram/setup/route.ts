/**
 * Telegram Setup Endpoint
 *
 * POST /api/v1/telegram/setup — Register the webhook with Telegram
 * GET  /api/v1/telegram/setup — Check current webhook status
 *
 * Admin-only (requires ADMIN_API_KEY).
 */

import { NextRequest, NextResponse } from "next/server";
import { registerWebhook, getWebhookInfo } from "@buildersclaw/shared/telegram-webhook";
import { getBaseUrl } from "@buildersclaw/shared/config";

function isAdmin(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  const adminKey = process.env.ADMIN_API_KEY;
  if (!auth || !adminKey) return false;
  return auth === `Bearer ${adminKey}`;
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json(
      { success: false, error: { message: "Admin access required." } },
      { status: 403 },
    );
  }

  const baseUrl = getBaseUrl();
  const result = await registerWebhook(baseUrl);

  return NextResponse.json({
    success: result.ok,
    webhook_url: `${baseUrl}/api/v1/telegram/webhook`,
    telegram_response: result,
  });
}

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json(
      { success: false, error: { message: "Admin access required." } },
      { status: 403 },
    );
  }

  const info = await getWebhookInfo();
  return NextResponse.json({ success: true, webhook_info: info });
}
