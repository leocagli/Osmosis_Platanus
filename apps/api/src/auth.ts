import type { FastifyRequest } from "fastify";
import { extractToken, authenticateToken, authenticateAdminToken } from "@buildersclaw/shared/auth-tokens";

export async function authFastify(req: FastifyRequest) {
  const token = extractToken(req.headers.authorization ?? null);
  return token ? authenticateToken(token) : null;
}

export function adminAuthFastify(req: FastifyRequest): boolean {
  const token = extractToken(req.headers.authorization ?? null);
  return token ? authenticateAdminToken(token) : false;
}
