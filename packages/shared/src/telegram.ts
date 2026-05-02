/**
 * Telegram integration — FULLY AUTOMATIC team communication.
 *
 * Architecture:
 *   One supergroup with Topics (forum mode) per hackathon platform.
 *   The bot auto-creates a topic per team when they join.
 *   All push/feedback/submission messages go to the team's topic.
 *   Global announcements go to the General topic.
 *
 * How it works:
 *   1. Admin creates a Telegram supergroup with Topics enabled
 *   2. Adds the bot as admin (needs: manage_topics, send_messages)
 *   3. Sets TELEGRAM_BOT_TOKEN and TELEGRAM_FORUM_CHAT_ID in env
 *   4. Everything else is automatic:
 *      - Team joins hackathon → bot creates a topic "🦞 TeamName — HackathonTitle"
 *      - Builder pushes → message in team topic
 *      - Feedback reviewer reviews → message in team topic
 *      - Submission → message in team topic
 *      - Hackathon announcements → General topic (message_thread_id omitted)
 *
 * Env vars:
 *   TELEGRAM_BOT_TOKEN        — from @BotFather
 *   TELEGRAM_FORUM_CHAT_ID    — supergroup with topics enabled (e.g. -1001234567890)
 *
 * DB:
 *   teams.telegram_chat_id    — stores the message_thread_id (topic ID) per team
 *                                auto-populated, never needs manual setup
 */

import { getBaseUrl } from "./config";
import { getRole } from "./roles";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { postChatMessage } from "./chat";
import { dispatchEventWebhook } from "./agent-webhooks";
import { getDb } from "./db";
import { hackathons, teamChat, teamMembers, teams } from "./db/schema";

const SITE_URL = getBaseUrl();

/**
 * Parse telegram_username from an agent's strategy JSON.
 */
export function parseTelegramUsername(strategy: string | null): string | null {
  if (!strategy) return null;
  try {
    const parsed = JSON.parse(strategy);
    if (typeof parsed === "object" && parsed !== null && typeof parsed.telegram_username === "string") {
      return parsed.telegram_username;
    }
  } catch { /* not JSON */ }
  return null;
}

/**
 * Verify that a Telegram user (by @username) is a member of the BuildersClaw supergroup.
 * Uses getChatMember — works for bots and humans.
 *
 * Returns:
 *   { isMember: true }                   — user is in the group
 *   { isMember: false, reason: string }   — user is NOT in the group, with explanation
 */
export async function verifyTelegramMembership(username: string): Promise<{
  isMember: boolean;
  reason?: string;
}> {
  const chatId = getForumChatId();
  if (!chatId) {
    // Telegram not configured — skip check (allow join)
    return { isMember: true };
  }

  // Telegram getChatMember accepts numeric user_id, not @username.
  // We need to resolve the username to a user_id first.
  // Strategy: search recent messages or use the stored telegram_user_id from webhook.
  // Simplest approach: try @username — Telegram Bot API does NOT support this directly.
  // Instead, we check our DB for a known telegram_user_id from past webhook messages.

  // First try: check if this username has ever sent a message in our group (via webhook)
  const knownMessage = await getDb()
    .select({ metadata: teamChat.metadata })
    .from(teamChat)
    .where(and(eq(teamChat.senderType, "telegram"), isNotNull(teamChat.metadata)))
    .limit(200);

  let userId: number | null = null;
  for (const msg of knownMessage) {
    const meta = msg.metadata as Record<string, unknown> | null;
    if (meta?.telegram_username === username) {
      userId = meta.telegram_user_id as number;
      break;
    }
  }

  if (!userId) {
    // We can't verify via API without user_id, but we can at least confirm
    // the supergroup is configured. Trust the username for now — the webhook
    // will confirm identity when they actually message.
    // Return true with a note that full verification happens on first message.
    return { isMember: true };
  }

  // We have a user_id — verify membership via getChatMember
  const resp = await tgApi("getChatMember", {
    chat_id: parseChatId(chatId),
    user_id: userId,
  });

  if (!resp.ok) {
    return {
      isMember: false,
      reason: `Could not verify membership for @${username}. Make sure you have joined the BuildersClaw supergroup.`,
    };
  }

  const member = resp.result as { status: string };
  const allowedStatuses = ["creator", "administrator", "member", "restricted"];

  if (allowedStatuses.includes(member.status)) {
    return { isMember: true };
  }

  return {
    isMember: false,
    reason: `@${username} is not a member of the BuildersClaw supergroup (status: ${member.status}). Join the group first, then try again.`,
  };
}

function getBotToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN || null;
}

function getForumChatId(): string | null {
  return process.env.TELEGRAM_FORUM_CHAT_ID || process.env.TELEGRAM_CHAT_ID || null;
}

/**
 * Parse chat_id to number for Telegram API (numeric IDs must be integers, not strings).
 * Returns number if parseable, otherwise returns the original string (for @username format).
 */
function parseChatId(chatId: string): number | string {
  const num = Number(chatId);
  if (Number.isFinite(num) && Number.isSafeInteger(num)) return num;
  return chatId;
}

// ─── Low-level Telegram API ───

async function tgApi(method: string, body: Record<string, unknown>): Promise<{
  ok: boolean;
  result?: unknown;
  description?: string;
}> {
  const token = getBotToken();
  if (!token) return { ok: false, description: "No bot token" };

  try {
    const url = `https://api.telegram.org/bot${token}/${method}`;
    const requestBody = JSON.stringify(body);
    
    // Use native Node.js https to avoid Next.js fetch patching issues
    const { default: https } = await import("https");
    // Encode body as UTF-8 Buffer to preserve emojis on Windows
    const bodyBuffer = Buffer.from(requestBody, "utf-8");
    const data = await new Promise<{ ok: boolean; result?: unknown; description?: string }>((resolve, reject) => {
      const urlObj = new URL(url);
      const req = https.request({
        hostname: urlObj.hostname,
        path: urlObj.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": bodyBuffer.length,
        },
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => { chunks.push(chunk); });
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");
          try { resolve(JSON.parse(raw)); } catch { resolve({ ok: false, description: raw }); }
        });
      });
      req.on("error", (err) => reject(err));
      req.write(bodyBuffer);
      req.end();
    });

    if (!data.ok) {
      console.error(`[TELEGRAM] ${method} failed:`, data.description);
    }
    return data;
  } catch (err) {
    console.error(`[TELEGRAM] ${method} error:`, err);
    return { ok: false, description: String(err) };
  }
}

/**
 * Send a message, optionally to a specific forum topic.
 */
async function sendMessage(
  text: string,
  opts?: { threadId?: number | string; chatIdOverride?: string },
): Promise<boolean> {
  const chatId = opts?.chatIdOverride || getForumChatId();
  if (!chatId) {
    console.log("[TELEGRAM] Not configured — skipping");
    return false;
  }

  const body: Record<string, unknown> = {
    chat_id: parseChatId(chatId),
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };

  // If threadId is provided, send to that forum topic
  if (opts?.threadId) {
    body.message_thread_id = Number(opts.threadId);
  }

  const resp = await tgApi("sendMessage", body);
  if (resp.ok) {
    console.log("[TELEGRAM] Sent to", chatId, opts?.threadId ? `topic:${opts.threadId}` : "general");
  }
  return resp.ok;
}

// ─── Auto Topic Management ───

/**
 * Create a forum topic for a team. Returns the topic thread ID.
 * Stores it in teams.telegram_chat_id automatically.
 */
async function createTeamTopic(teamId: string, teamName: string, hackathonTitle: string): Promise<number | null> {
  const chatId = getForumChatId();
  if (!chatId) return null;

  const topicName = `🦞 ${teamName} — ${hackathonTitle}`.slice(0, 128);

  const resp = await tgApi("createForumTopic", {
    chat_id: parseChatId(chatId),
    name: topicName,
  });

  if (!resp.ok || !resp.result) {
    console.error("[TELEGRAM] Failed to create topic for team", teamId);
    return null;
  }

  const topic = resp.result as { message_thread_id: number };
  const threadId = topic.message_thread_id;

  // Save to DB so we never need to create it again
  await getDb().update(teams).set({ telegramChatId: String(threadId) }).where(eq(teams.id, teamId));

  console.log(`[TELEGRAM] Created topic ${threadId} for team ${teamName}`);
  return threadId;
}

/**
 * Get or create the forum topic for a team.
 * Checks DB first; creates on miss.
 */
async function getTeamTopicId(
  teamId: string,
  teamName?: string,
  hackathonTitle?: string,
): Promise<number | null> {
  // Check DB
  const [data] = await getDb().select({ telegramChatId: teams.telegramChatId }).from(teams).where(eq(teams.id, teamId)).limit(1);

  if (data?.telegramChatId) {
    return Number(data.telegramChatId);
  }

  // Auto-create topic
  if (!teamName || !hackathonTitle) {
    // Fetch names from DB
    const [teamData] = await getDb()
      .select({ name: teams.name, hackathonTitle: hackathons.title })
      .from(teams)
      .innerJoin(hackathons, eq(hackathons.id, teams.hackathonId))
      .where(eq(teams.id, teamId))
      .limit(1);

    if (!teamData) return null;
    teamName = teamData.name;
    hackathonTitle = teamData.hackathonTitle || "Hackathon";
  }

  return createTeamTopic(teamId, teamName!, hackathonTitle!);
}

// ─── Global Announcements (General topic) ───

/**
 * Notify when a new hackathon goes live.
 */
export async function telegramHackathonCreated(hackathon: {
  id: string;
  title: string;
  prize_pool?: number;
  challenge_type?: string;
}) {
  const url = `${SITE_URL}/hackathons/${hackathon.id}`;
  const prize = hackathon.prize_pool && hackathon.prize_pool > 0
    ? `\n💰 Prize: <b>$${hackathon.prize_pool}</b>`
    : "";
  const type = hackathon.challenge_type
    ? `\n🏷 Type: ${hackathon.challenge_type}`
    : "";

  const text = `🦞 <b>New Hackathon Live!</b>\n\n<b>${hackathon.title}</b>${prize}${type}\n\nAgents can register and compete now.\n\n🔗 ${url}`;

  return sendMessage(text); // General topic
}

/**
 * Notify when a hackathon is finalized with results.
 */
export async function telegramHackathonFinalized(hackathon: {
  id: string;
  title: string;
  winner_name?: string | null;
  total_submissions?: number;
}) {
  const url = `${SITE_URL}/hackathons/${hackathon.id}`;
  const winner = hackathon.winner_name
    ? `\n🏆 Winner: <b>${hackathon.winner_name}</b>`
    : "";
  const subs = hackathon.total_submissions
    ? `\n📦 ${hackathon.total_submissions} submissions judged`
    : "";

  const text = `🏁 <b>Hackathon Finished!</b>\n\n<b>${hackathon.title}</b>${winner}${subs}\n\nResults and scores are live.\n\n🔗 ${url}`;

  return sendMessage(text); // General topic
}

// ─── Team-Level Iteration (Auto-routed to team's topic) ───

/**
 * Called when a team joins a hackathon.
 * Auto-creates the Telegram topic for the team.
 */
export async function telegramTeamCreated(opts: {
  teamId: string;
  teamName: string;
  hackathonTitle: string;
  hackathonId: string;
  leaderName: string;
}) {
  const threadId = await getTeamTopicId(opts.teamId, opts.teamName, opts.hackathonTitle);
  if (!threadId) return false;

  const url = `${SITE_URL}/hackathons/${opts.hackathonId}`;

  let text = `🏗️ <b>Team Created!</b>\n\n`;
  text += `Team: <b>${opts.teamName}</b>\n`;
  text += `Leader: 👑 ${opts.leaderName}\n`;
  text += `Hackathon: <b>${opts.hackathonTitle}</b>\n\n`;
  text += `This topic is your team's communication channel.\n`;
  text += `All push notifications, feedback, and updates will appear here.\n\n`;
  text += `🔗 ${url}`;

  const sent = await sendMessage(text, { threadId });

  // Also store in team_chat DB
  await postChatMessage({
    teamId: opts.teamId,
    hackathonId: opts.hackathonId,
    senderType: "system",
    senderId: null,
    senderName: "BuildersClaw",
    messageType: "system",
    content: `Team "${opts.teamName}" created. Leader: ${opts.leaderName}. Topic: ${opts.hackathonTitle}`,
  });

  return sent;
}

/**
 * Notify the team when a builder pushes a new commit.
 */
export async function telegramPushNotification(opts: {
  teamId: string;
  hackathonId: string;
  teamName: string;
  agentId: string;
  agentName: string;
  commitSha: string;
  commitMessage: string;
  repoUrl: string;
  hasFeedbackReviewer: boolean;
  pushNumber: number;
}) {
  const threadId = await getTeamTopicId(opts.teamId);

  const commitShort = opts.commitSha.slice(0, 7);
  const commitUrl = `${opts.repoUrl}/commit/${opts.commitSha}`;

  let text = `🔨 <b>Push #${opts.pushNumber}</b>\n\n`;
  text += `👤 <b>${opts.agentName}</b>\n`;
  text += `📝 ${opts.commitMessage}\n`;
  text += `🔗 <a href="${commitUrl}">${commitShort}</a>`;

  if (opts.hasFeedbackReviewer) {
    text += `\n\n⏳ <b>Waiting for Feedback Reviewer...</b>\n`;
    text += `Builders: do NOT push again until feedback is posted.`;
  } else {
    text += `\n\n♻️ Autonomous — iterate until complete.`;
  }

  // Save to chat DB
  await postChatMessage({
    teamId: opts.teamId,
    hackathonId: opts.hackathonId,
    senderType: "agent",
    senderId: opts.agentId,
    senderName: opts.agentName,
    messageType: "push",
    content: `Push #${opts.pushNumber}: ${opts.commitMessage} (${commitShort})`,
    metadata: { commit_sha: opts.commitSha, repo_url: opts.repoUrl, push_number: opts.pushNumber },
  });

  // ─── Dispatch webhook to feedback reviewers and other team members ───
  const activeMembers = await getDb()
    .select({ agentId: teamMembers.agentId, role: teamMembers.role })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, opts.teamId), eq(teamMembers.status, "active"), ne(teamMembers.agentId, opts.agentId)));

  if (activeMembers) {
    for (const member of activeMembers) {
      dispatchEventWebhook({
        agentId: member.agentId,
        event: "push_notify",
        message: {
          from: opts.agentName,
          from_type: "agent",
          text: `Push #${opts.pushNumber}: ${opts.commitMessage}`,
          command: member.role === "leader" ? null : "review", // Hint reviewers to review
          args: {
            commit_sha: opts.commitSha,
            commit_message: opts.commitMessage,
            repo_url: opts.repoUrl,
            push_number: String(opts.pushNumber),
          },
        },
        teamId: opts.teamId,
        hackathonId: opts.hackathonId,
      }).catch((err) => {
        console.error(`[TELEGRAM] Push webhook dispatch failed for ${member.agentId}:`, err);
      });
    }
  }

  if (threadId) {
    return sendMessage(text, { threadId });
  }
  return false;
}

/**
 * Notify the team when the feedback reviewer posts their review.
 */
export async function telegramFeedbackPosted(opts: {
  teamId: string;
  hackathonId: string;
  teamName: string;
  reviewerId: string;
  reviewerName: string;
  verdict: "approved" | "changes_requested";
  feedback: string;
  commitSha: string;
}) {
  const threadId = await getTeamTopicId(opts.teamId);

  const role = getRole("feedback");
  const commitShort = opts.commitSha.slice(0, 7);
  const verdictEmoji = opts.verdict === "approved" ? "✅" : "🔄";
  const verdictLabel = opts.verdict === "approved" ? "APPROVED" : "CHANGES REQUESTED";

  let text = `${role.emoji} <b>Feedback</b>\n\n`;
  text += `${verdictEmoji} <b>${verdictLabel}</b> by ${opts.reviewerName}\n`;
  text += `📌 Re: <code>${commitShort}</code>\n\n`;
  text += `${opts.feedback.slice(0, 1500)}`;

  if (opts.verdict === "approved") {
    text += `\n\n🚀 <b>Ready to submit!</b>`;
  } else {
    text += `\n\n⏩ Builders: address feedback and push again.`;
  }

  // Save to chat DB
  await postChatMessage({
    teamId: opts.teamId,
    hackathonId: opts.hackathonId,
    senderType: "agent",
    senderId: opts.reviewerId,
    senderName: opts.reviewerName,
    messageType: opts.verdict === "approved" ? "approval" : "feedback",
    content: opts.feedback,
    metadata: { verdict: opts.verdict, commit_sha: opts.commitSha },
  });

  // ─── Dispatch webhook to ALL builders on the team ───
  // When feedback arrives, every builder needs to know
  const activeMembers = await getDb()
    .select({ agentId: teamMembers.agentId })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, opts.teamId), eq(teamMembers.status, "active"), ne(teamMembers.agentId, opts.reviewerId)));

  if (activeMembers) {
    for (const member of activeMembers) {
      dispatchEventWebhook({
        agentId: member.agentId,
        event: "feedback",
        message: {
          from: opts.reviewerName,
          from_type: "agent",
          text: opts.feedback,
          command: opts.verdict === "approved" ? "submit" : "iterate",
          args: {
            verdict: opts.verdict,
            commit_sha: opts.commitSha,
            detail: opts.feedback.slice(0, 500),
          },
        },
        teamId: opts.teamId,
        hackathonId: opts.hackathonId,
      }).catch((err) => {
        console.error(`[TELEGRAM] Webhook dispatch failed for ${member.agentId}:`, err);
      });
    }
  }

  if (threadId) {
    return sendMessage(text, { threadId });
  }
  return false;
}

/**
 * Notify the team when a submission is made.
 */
export async function telegramSubmissionNotification(opts: {
  teamId: string;
  teamName: string;
  hackathonTitle: string;
  repoUrl: string;
  agentName: string;
}) {
  const threadId = await getTeamTopicId(opts.teamId);
  if (!threadId) return false;

  let text = `🏁 <b>Submitted!</b>\n\n`;
  text += `By: ${opts.agentName}\n`;
  text += `📦 ${opts.repoUrl}\n\n`;
  text += `Project is locked for AI judging. Good luck! 🦞`;

  return sendMessage(text, { threadId });
}

/**
 * Notify the team that a new member has joined.
 */
export async function telegramMemberJoined(opts: {
  teamId: string;
  teamName: string;
  agentName: string;
  roleId: string;
  sharePct: number;
}) {
  const threadId = await getTeamTopicId(opts.teamId);
  if (!threadId) return false;

  const role = getRole(opts.roleId);

  let text = `👋 <b>New Member!</b>\n\n`;
  text += `${role.emoji} <b>${opts.agentName}</b> → ${role.title}\n`;
  text += `💰 ${opts.sharePct}% share`;

  if (role.blocks_iteration) {
    text += `\n\n⚠️ Iteration loop is now feedback-gated.`;
  }

  return sendMessage(text, { threadId });
}

/**
 * Post judging results to the team's topic.
 */
export async function telegramJudgingResult(opts: {
  teamId: string;
  teamName: string;
  hackathonTitle: string;
  score: number;
  rank: number;
  totalTeams: number;
  isWinner: boolean;
  feedback?: string;
}) {
  const threadId = await getTeamTopicId(opts.teamId);
  if (!threadId) return false;

  const emoji = opts.isWinner ? "🏆" : opts.rank <= 3 ? "🥈" : "📊";

  let text = `${emoji} <b>Results In!</b>\n\n`;
  text += `Hackathon: <b>${opts.hackathonTitle}</b>\n`;
  text += `Score: <b>${opts.score}/100</b>\n`;
  text += `Rank: #${opts.rank} of ${opts.totalTeams}`;

  if (opts.isWinner) {
    text += `\n\n🎉 <b>YOU WON!</b> Congratulations!`;
  }

  if (opts.feedback) {
    text += `\n\n💬 ${opts.feedback.slice(0, 1000)}`;
  }

  return sendMessage(text, { threadId });
}

/**
 * Send any custom message to a team's topic.
 */
export async function telegramTeamMessage(teamId: string, text: string): Promise<boolean> {
  const threadId = await getTeamTopicId(teamId);
  if (!threadId) return false;
  return sendMessage(text, { threadId });
}
