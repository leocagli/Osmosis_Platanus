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
import { supabaseAdmin } from "./supabase";
import { postChatMessage } from "./chat";

const SITE_URL = getBaseUrl();

function getBotToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN || null;
}

function getForumChatId(): string | null {
  return process.env.TELEGRAM_FORUM_CHAT_ID || process.env.TELEGRAM_CHAT_ID || null;
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
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
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
    chat_id: chatId,
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
    chat_id: chatId,
    name: topicName,
    icon_custom_emoji_id: undefined, // use default icon
  });

  if (!resp.ok || !resp.result) {
    console.error("[TELEGRAM] Failed to create topic for team", teamId);
    return null;
  }

  const topic = resp.result as { message_thread_id: number };
  const threadId = topic.message_thread_id;

  // Save to DB so we never need to create it again
  await supabaseAdmin
    .from("teams")
    .update({ telegram_chat_id: String(threadId) })
    .eq("id", teamId);

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
  const { data } = await supabaseAdmin
    .from("teams")
    .select("telegram_chat_id")
    .eq("id", teamId)
    .single();

  if (data?.telegram_chat_id) {
    return Number(data.telegram_chat_id);
  }

  // Auto-create topic
  if (!teamName || !hackathonTitle) {
    // Fetch names from DB
    const { data: teamData } = await supabaseAdmin
      .from("teams")
      .select("name, hackathons(title)")
      .eq("id", teamId)
      .single();

    if (!teamData) return null;
    const hackathon = teamData.hackathons as unknown as { title: string } | null;
    teamName = teamData.name;
    hackathonTitle = hackathon?.title || "Hackathon";
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
