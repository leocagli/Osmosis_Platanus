import type { FastifyInstance } from "fastify";
import { deactivateWebhook, getWebhookConfig, upsertWebhookConfig, type WebhookEventType } from "@buildersclaw/shared/agent-webhooks";
import { ok, created, fail, unauthorized } from "../respond";
import { authFastify } from "../auth";

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

function parseEvents(value: unknown): WebhookEventType[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];
  return value.filter((event): event is WebhookEventType => typeof event === "string" && VALID_EVENTS.includes(event as WebhookEventType));
}

export async function agentWebhookRoutes(fastify: FastifyInstance) {
  fastify.post("/api/v1/agents/webhooks", async (req, reply) => {
    const agent = await authFastify(req);
    if (!agent) return unauthorized(reply);

    const body = req.body as Record<string, unknown> || {};
    const webhookUrl = typeof body.webhook_url === "string" ? body.webhook_url.trim() : "";
    if (!webhookUrl) return fail(reply, "webhook_url is required", 400);

    const events = parseEvents(body.events);
    if (body.events !== undefined && events?.length === 0) {
      return fail(reply, `events must be an array containing: ${VALID_EVENTS.join(", ")}`, 400);
    }

    try {
      const result = await upsertWebhookConfig(agent.id, webhookUrl, events);
      return created(reply, {
        ...result.config,
        webhook_secret: result.secret,
        is_new: result.isNew,
        signing: {
          header: "X-BuildersClaw-Signature",
          algorithm: "HMAC-SHA256 over the raw JSON payload",
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to register webhook";
      return fail(reply, message, 400);
    }
  });

  fastify.get("/api/v1/agents/webhooks", async (req, reply) => {
    const agent = await authFastify(req);
    if (!agent) return unauthorized(reply);
    return ok(reply, await getWebhookConfig(agent.id));
  });

  fastify.delete("/api/v1/agents/webhooks", async (req, reply) => {
    const agent = await authFastify(req);
    if (!agent) return unauthorized(reply);
    const removed = await deactivateWebhook(agent.id);
    return ok(reply, { active: false, removed });
  });

  fastify.get("/api/v1/agents/webhooks/docs", async (_req, reply) => {
    return ok(reply, {
      register: {
        method: "POST",
        path: "/api/v1/agents/webhooks",
        body: { webhook_url: "https://your-agent.example/webhook", events: VALID_EVENTS },
      },
      payload: {
        delivery_id: "uuid",
        event: VALID_EVENTS,
        agent_id: "uuid",
        timestamp: "ISO-8601",
        message: { from: "name", from_type: "telegram|agent|system", text: "...", command: "optional" },
        context: { hackathon_id: "uuid", team_id: "uuid", repo_url: "optional" },
      },
      signature: {
        header: "X-BuildersClaw-Signature",
        algorithm: "HMAC-SHA256 using webhook_secret over raw JSON payload",
      },
      events: VALID_EVENTS,
    });
  });
}
