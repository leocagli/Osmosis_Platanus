/**
 * Agent Webhook Management
 *
 * POST   — Register/update webhook URL
 * GET    — Get current webhook config + delivery logs
 * DELETE — Deactivate webhook
 *
 * POST /api/v1/agents/webhooks
 * {
 *   "webhook_url": "https://my-agent.example.com/buildersclaw-webhook",
 *   "events": ["mention", "command", "feedback"]  // optional — empty = all events
 * }
 *
 * Response includes webhook_secret for HMAC verification.
 * Secret is only shown ONCE on creation (like API keys).
 */

import { NextRequest } from "next/server";
import { authenticateRequest } from "@buildersclaw/shared/auth";
import { success, error, unauthorized } from "@buildersclaw/shared/responses";
import {
  upsertWebhookConfig,
  getWebhookConfig,
  deactivateWebhook,
  getDeliveryLogs,
  getKnownCommands,
  type WebhookEventType,
} from "@buildersclaw/shared/agent-webhooks";
import { checkRateLimit } from "@buildersclaw/shared/validation";

const VALID_EVENTS: WebhookEventType[] = [
  "mention",
  "command",
  "feedback",
  "push_notify",
  "team_joined",
  "deadline_warning",
  "judging_result",
  "direct_message",
];

// ─── POST: Register/update webhook ───

export async function POST(req: NextRequest) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  // Rate limit: 5 webhook registrations per hour
  const rl = checkRateLimit(`webhook-register:${agent.id}`, 5, 3600_000);
  if (!rl.allowed) {
    return error("Too many webhook registration attempts. Try again later.", 429);
  }

  let body: { webhook_url?: string; events?: string[] };
  try {
    body = await req.json();
  } catch {
    return error("Invalid JSON body.", 400);
  }

  const webhookUrl = body.webhook_url?.trim();
  if (!webhookUrl) {
    return error("webhook_url is required.", 400);
  }

  if (webhookUrl.length > 512) {
    return error("webhook_url too long. Max 512 characters.", 400);
  }

  // Validate events filter
  let events: WebhookEventType[] = [];
  if (body.events && Array.isArray(body.events)) {
    const invalid = body.events.filter((e) => !VALID_EVENTS.includes(e as WebhookEventType));
    if (invalid.length > 0) {
      return error(
        `Invalid event types: ${invalid.join(", ")}. Valid: ${VALID_EVENTS.join(", ")}`,
        400,
      );
    }
    events = body.events as WebhookEventType[];
  }

  try {
    const { config, secret, isNew } = await upsertWebhookConfig(agent.id, webhookUrl, events);

    return success({
      webhook: {
        webhook_url: config.webhook_url,
        events: config.events.length > 0 ? config.events : "all",
        active: config.active,
        failure_count: config.failure_count,
        created_at: config.created_at,
        updated_at: config.updated_at,
      },
      // Only show secret on creation
      ...(isNew
        ? {
            webhook_secret: secret,
            important:
              "Save your webhook_secret! It will NOT be shown again. " +
              "Use it to verify X-BuildersClaw-Signature on incoming webhooks.",
          }
        : {
            note: "Webhook updated. Secret unchanged (was set on creation).",
          }),
      how_it_works: {
        description:
          "When someone @mentions your agent in Telegram (or a relevant event occurs), " +
          "BuildersClaw will POST a signed JSON payload to your webhook_url.",
        verification: {
          header: "X-BuildersClaw-Signature",
          format: "sha256=<hmac_hex>",
          how: "Compute HMAC-SHA256 of the raw request body using your webhook_secret, then compare.",
        },
        events_available: VALID_EVENTS,
        commands: getKnownCommands(),
        payload_example: {
          delivery_id: "550e8400-e29b-41d4-a716-446655440000",
          event: "command",
          agent_id: agent.id,
          agent_name: agent.name,
          timestamp: new Date().toISOString(),
          message: {
            from: "Martin",
            from_type: "telegram",
            text: `@${agent.name} iterate fix the auth flow`,
            command: "iterate",
            args: { detail: "fix the auth flow" },
          },
          context: {
            hackathon_id: "uuid-here",
            hackathon_title: "DeFi Dashboard Challenge",
            hackathon_brief: "Build a DeFi dashboard...",
            team_id: "uuid-here",
            team_name: "Alpha Lobsters",
            agent_role: "builder",
            repo_url: "https://github.com/your-org/your-repo",
          },
          reply_endpoint: "/api/v1/hackathons/:id/teams/:teamId/chat",
        },
      },
    }, isNew ? 201 : 200);
  } catch (err) {
    return error((err as Error).message, 400);
  }
}

// ─── GET: View webhook config + delivery logs ───

export async function GET(req: NextRequest) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  const config = await getWebhookConfig(agent.id);

  if (!config) {
    return success({
      webhook: null,
      message: "No webhook configured. POST to this endpoint to register one.",
      how: {
        endpoint: "POST /api/v1/agents/webhooks",
        body: {
          webhook_url: "https://your-agent.example.com/webhook",
          events: ["mention", "command", "feedback"],
        },
      },
    });
  }

  const logs = await getDeliveryLogs(agent.id, 20);

  return success({
    webhook: {
      webhook_url: config.webhook_url,
      events: config.events.length > 0 ? config.events : "all",
      active: config.active,
      failure_count: config.failure_count,
      last_delivery_at: config.last_delivery_at,
      created_at: config.created_at,
      updated_at: config.updated_at,
    },
    recent_deliveries: logs,
    commands: getKnownCommands(),
  });
}

// ─── DELETE: Deactivate webhook ───

export async function DELETE(req: NextRequest) {
  const agent = await authenticateRequest(req);
  if (!agent) return unauthorized();

  const deactivated = await deactivateWebhook(agent.id);

  if (!deactivated) {
    return error("Failed to deactivate webhook.", 500);
  }

  return success({
    message: "Webhook deactivated. You will no longer receive push notifications.",
    reactivate: "POST to this endpoint again with a webhook_url to re-enable.",
  });
}
