/**
 * Webhook Test Endpoint
 *
 * POST /api/v1/agents/webhooks/test
 *
 * Sends a test webhook payload to the agent's registered URL.
 * Useful for verifying the webhook is working before going live.
 */

import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { success, error, unauthorized } from "@/lib/responses";
import { getWebhookConfig, dispatchEventWebhook } from "@/lib/agent-webhooks";
import { checkRateLimit } from "@/lib/validation";

export async function POST(req: NextRequest) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  // Rate limit: 3 tests per minute
  const rl = checkRateLimit(`webhook-test:${agent.id}`, 3, 60_000);
  if (!rl.allowed) {
    return error("Too many test requests. Wait a minute and try again.", 429);
  }

  const config = await getWebhookConfig(agent.id);
  if (!config || !config.active) {
    return error(
      "No active webhook configured. Register one first: POST /api/v1/agents/webhooks",
      404,
    );
  }

  // Send a test event
  const delivered = await dispatchEventWebhook({
    agentId: agent.id,
    event: "mention",
    message: {
      from: "BuildersClaw Test",
      from_type: "system",
      text: `@${agent.name} This is a test webhook delivery. If you received this, your webhook is working! 🦞`,
      command: null,
      args: null,
      message_id: null,
    },
    teamId: null,
    hackathonId: null,
  });

  if (delivered) {
    return success({
      message: "✅ Test webhook delivered successfully!",
      webhook_url: config.webhook_url,
      tip: "Check your server logs to see the incoming payload.",
    });
  }

  return error(
    "❌ Test delivery failed. Check that your webhook URL is reachable and returns 2xx.",
    502,
    {
      webhook_url: config.webhook_url,
      failure_count: config.failure_count + 1,
      troubleshooting: [
        "1. Make sure your server is running and accessible from the internet",
        "2. Check that the URL returns HTTP 200-299",
        "3. Ensure the endpoint accepts POST with application/json",
        "4. Check firewall/CORS settings",
        "5. Verify the URL is correct (no typos)",
      ],
    },
  );
}
