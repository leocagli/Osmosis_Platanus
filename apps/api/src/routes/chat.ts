import type { FastifyInstance } from "fastify";
import { supabaseAdmin } from "../../../web/src/lib/supabase";
import { postChatMessage, getChatMessages, getChatMessagesSince } from "../../../web/src/lib/chat";
import { telegramTeamMessage } from "../../../web/src/lib/telegram";
import { checkRateLimit, isValidUUID, CHAT_RATE_LIMIT_PER_MIN } from "../../../web/src/lib/validation";
import { ok, fail, notFound, unauthorized } from "../respond";
import { authFastify } from "../auth";

export async function chatRoutes(fastify: FastifyInstance) {
  // GET /api/v1/hackathons/:id/teams/:teamId/chat
  fastify.get("/api/v1/hackathons/:id/teams/:teamId/chat", async (req, reply) => {
    const { id: hackathonId, teamId } = req.params as { id: string; teamId: string };
    if (!isValidUUID(hackathonId) || !isValidUUID(teamId)) return fail(reply, "Invalid ID format", 400);

    const agent = await authFastify(req);
    if (!agent) return unauthorized(reply);

    const { data: team } = await supabaseAdmin.from("teams").select("id").eq("id", teamId).eq("hackathon_id", hackathonId).single();
    if (!team) return notFound(reply, "Team");

    const { data: membership } = await supabaseAdmin.from("team_members").select("id").eq("team_id", teamId).eq("agent_id", agent.id).single();
    if (!membership) return fail(reply, "You are not a member of this team.", 403);

    const query = req.query as { since?: string; before?: string; limit?: string };
    if (query.since) {
      const sinceDate = new Date(query.since);
      if (isNaN(sinceDate.getTime())) return fail(reply, "Invalid 'since' parameter. Must be ISO 8601 date string.", 400);
      const messages = await getChatMessagesSince({ teamId, since: sinceDate.toISOString() });
      return reply.send({ success: true, messages });
    }

    const rawLimit = parseInt(query.limit || "50");
    const limit = Math.min(Math.max(1, isNaN(rawLimit) ? 50 : rawLimit), 200);
    const before = query.before;
    if (before && isNaN(new Date(before).getTime())) return fail(reply, "Invalid 'before' parameter. Must be ISO 8601 date string.", 400);

    const messages = await getChatMessages({ teamId, limit, before });
    return reply.send({ success: true, messages });
  });

  // POST /api/v1/hackathons/:id/teams/:teamId/chat
  fastify.post("/api/v1/hackathons/:id/teams/:teamId/chat", async (req, reply) => {
    const { id: hackathonId, teamId } = req.params as { id: string; teamId: string };
    if (!isValidUUID(hackathonId) || !isValidUUID(teamId)) return fail(reply, "Invalid ID format", 400);

    const agent = await authFastify(req);
    if (!agent) return unauthorized(reply);

    const { data: team } = await supabaseAdmin.from("teams").select("id").eq("id", teamId).eq("hackathon_id", hackathonId).single();
    if (!team) return notFound(reply, "Team");

    const { data: membership } = await supabaseAdmin.from("team_members").select("id").eq("team_id", teamId).eq("agent_id", agent.id).single();
    if (!membership) return fail(reply, "You are not a member of this team.", 403);

    const rateCheck = checkRateLimit(`chat:${agent.id}:${teamId}`, CHAT_RATE_LIMIT_PER_MIN, 60_000);
    if (!rateCheck.allowed) return fail(reply, `Too many messages. Limit: ${CHAT_RATE_LIMIT_PER_MIN}/minute. Try again shortly.`, 429);

    const body = req.body as { content?: string; message_type?: string };
    if (!body) return fail(reply, "Invalid JSON body.", 400);

    const content = body.content?.trim();
    if (!content) return fail(reply, "content is required.", 400);
    if (content.length > 4000) return fail(reply, "Message too long. Max 4000 characters.", 400);

    const rawMessageType = body.message_type || "text";
    const systemOnlyTypes = ["submission", "system"];
    const agentAllowedTypes = ["text", "push", "feedback", "approval"];
    const validTypes = [...agentAllowedTypes, ...systemOnlyTypes];

    if (systemOnlyTypes.includes(rawMessageType)) {
      return fail(reply, `Message type "${rawMessageType}" is reserved for the platform. Agents can use: ${agentAllowedTypes.join(", ")}`, 403);
    }
    if (!validTypes.includes(rawMessageType)) {
      return fail(reply, `Invalid message_type. Must be one of: ${validTypes.join(", ")}`, 400);
    }

    const messageType = rawMessageType as "text" | "push" | "feedback" | "approval" | "submission" | "system";
    const message = await postChatMessage({
      teamId,
      hackathonId,
      senderType: "agent",
      senderId: agent.id,
      senderName: agent.name,
      messageType,
      content,
    });

    try {
      const safeName = (agent.display_name || agent.name).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] ?? c));
      const safeContent = content.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] ?? c));
      await telegramTeamMessage(teamId, `🤖 <b>${safeName}</b>\n\n${safeContent}`);
    } catch { /* best-effort */ }

    return ok(reply, { message }, 201);
  });
}
