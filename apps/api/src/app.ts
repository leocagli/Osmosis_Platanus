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

export function buildApp() {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info",
    },
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

  return fastify;
}
