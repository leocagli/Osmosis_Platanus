import Fastify from "fastify";
import { healthRoutes } from "./routes/health";
import { overviewRoutes } from "./routes/overview";
import { hackathonRoutes } from "./routes/hackathons";
import { adminRoutes } from "./routes/admin";
import { cronRoutes } from "./routes/cron";
import { telegramRoutes } from "./routes/telegram";
import { agentRoutes } from "./routes/agents";
import { joinRoutes } from "./routes/joins";
import { chatRoutes } from "./routes/chat";
import { submitRoutes } from "./routes/submit";
import { balanceRoutes } from "./routes/balance";
import { chainRoutes } from "./routes/chain";
import { agentWebhookRoutes } from "./routes/agent-webhooks";
import { proposalRoutes } from "./routes/proposals";
import { marketplaceRoutes } from "./routes/marketplace";
import { peerJudgmentRoutes } from "./routes/peer-judgments";
import { ensRoutes } from "./routes/ens";

export function buildApp() {
  const fastify = Fastify({
    maxParamLength: 8192,
    logger: {
      level: process.env.LOG_LEVEL || "info",
    },
  });

  const staticAllowedOrigins = new Set(
    [
      process.env.NEXT_PUBLIC_APP_URL,
      process.env.APP_URL,
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ].filter(Boolean),
  );

  const allowedOriginPatterns: RegExp[] = [
    /^https:\/\/(www\.)?buildersclaw\.xyz$/,
    /^https:\/\/[a-z0-9-]+\.buildersclaw\.xyz$/,
    /^https:\/\/buildersclaw(-[a-z0-9-]+)?-stevenmlx\.vercel\.app$/,
    /^http:\/\/localhost(:\d+)?$/,
    /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  ];

  const isOriginAllowed = (origin: string): boolean =>
    staticAllowedOrigins.has(origin) ||
    allowedOriginPatterns.some((re) => re.test(origin));

  fastify.addHook("onRequest", (request, reply, done) => {
    const origin = request.headers.origin;
    const allowed = !!origin && isOriginAllowed(origin);

    if (allowed) {
      reply.header("Access-Control-Allow-Origin", origin!);
      reply.header("Vary", "Origin");
      reply.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
      reply.header("Access-Control-Allow-Headers", "Content-Type,Authorization");
    }

    if (request.method === "OPTIONS") {
      reply.code(allowed ? 204 : 403).send();
      return;
    }

    done();
  });

  fastify.register(healthRoutes);
  fastify.register(overviewRoutes);
  fastify.register(hackathonRoutes);
  fastify.register(adminRoutes);
  fastify.register(cronRoutes);
  fastify.register(telegramRoutes);
  fastify.register(agentRoutes);
  fastify.register(joinRoutes);
  fastify.register(chatRoutes);
  fastify.register(submitRoutes);
  fastify.register(balanceRoutes);
  fastify.register(chainRoutes);
  fastify.register(agentWebhookRoutes);
  fastify.register(proposalRoutes);
  fastify.register(marketplaceRoutes);
  fastify.register(peerJudgmentRoutes);
  fastify.register(ensRoutes);

  return fastify;
}
