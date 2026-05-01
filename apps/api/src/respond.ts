import type { FastifyReply } from "fastify";

export function ok(reply: FastifyReply, data: unknown, status = 200) {
  return reply.code(status).send({ success: true, data });
}

export function created(reply: FastifyReply, data: unknown) {
  return ok(reply, data, 201);
}

export function fail(
  reply: FastifyReply,
  message: string,
  status = 400,
  hint?: string | Record<string, unknown>,
) {
  const errorBody: Record<string, unknown> = { message };
  if (hint && typeof hint === "string") errorBody.hint = hint;
  else if (hint && typeof hint === "object") Object.assign(errorBody, hint);
  return reply.code(status).send({ success: false, error: errorBody });
}

export function notFound(reply: FastifyReply, resource = "Resource") {
  return fail(reply, `${resource} not found`, 404);
}

export function unauthorized(reply: FastifyReply, message = "Authentication required") {
  return fail(reply, message, 401, "Add 'Authorization: Bearer buildersclaw_...' header");
}
