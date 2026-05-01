import { buildApp } from "./app";

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3001);

const fastify = buildApp();

fastify.listen({ host, port }, (err) => {
  if (err) {
    fastify.log.error(err);
    process.exitCode = 1;
  }
});
