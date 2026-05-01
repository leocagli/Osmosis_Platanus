import type { FastifyInstance } from "fastify";
import { validateWebhookSecret } from "../../../web/src/lib/telegram-webhook";
import { enqueueJob } from "../../../web/src/lib/queue";

export async function telegramRoutes(fastify: FastifyInstance) {
  fastify.post("/api/v1/telegram/webhook", async (req, reply) => {
    const secret = (req.headers as { "x-telegram-bot-api-secret-token"?: string })["x-telegram-bot-api-secret-token"] ?? null;
    if (!validateWebhookSecret(secret)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const update = req.body;
    if (!update) return reply.code(400).send({ error: "Invalid JSON" });

    try {
      await enqueueJob({
        type: "telegram.process_update",
        payload: { update: update as Record<string, unknown> },
        maxAttempts: 5,
      });
    } catch (err) {
      console.error("[TG-WEBHOOK] Enqueue error:", err);
      return reply.code(500).send({ error: "Failed to enqueue update" });
    }

    return reply.send({ ok: true });
  });
}
