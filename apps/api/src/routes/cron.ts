import crypto from "crypto";
import type { FastifyInstance } from "fastify";
import { processExpiredHackathons, processQueuedGenLayerHackathons } from "@buildersclaw/shared/judge-trigger";

export async function cronRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/cron/judge", async (req, reply) => {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return reply.code(500).send({ error: "CRON_SECRET not configured. This endpoint requires authentication." });
    }

    const authHeader = (req.headers as { authorization?: string }).authorization;
    if (!authHeader) {
      return reply.code(401).send({ error: "Unauthorized — Bearer token required" });
    }

    const providedToken = authHeader.replace("Bearer ", "");
    if (providedToken.length !== cronSecret.length) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const tokensMatch = crypto.timingSafeEqual(
      Buffer.from(providedToken, "utf-8"),
      Buffer.from(cronSecret, "utf-8"),
    );
    if (!tokensMatch) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const [expired, queued] = await Promise.all([
      processExpiredHackathons({ enqueueOnly: true }),
      processQueuedGenLayerHackathons({ enqueueOnly: true }),
    ]);

    return reply.send({
      success: true,
      message: `Enqueued ${(expired?.count || 0) + (queued?.count || 0)} cron tasks`,
      details: { expired: expired?.processed || [], genlayer: queued?.processed || [] },
    });
  });
}
