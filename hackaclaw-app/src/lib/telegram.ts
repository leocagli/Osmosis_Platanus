/**
 * Telegram integration — post to the BuildersClaw community channel.
 *
 * Uses Telegram Bot API (simple HTTP POST, no libraries).
 * Set these env vars:
 *   TELEGRAM_BOT_TOKEN   — from @BotFather
 *   TELEGRAM_CHAT_ID     — channel/group ID (e.g. @buildersclaw or -1001234567890)
 *
 * If either is missing, messages are silently skipped.
 */

const SITE_URL = "https://buildersclaw.vercel.app";

function getConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return null;
  return { token, chatId };
}

async function sendMessage(text: string): Promise<boolean> {
  const config = getConfig();
  if (!config) {
    console.log("[TELEGRAM] Not configured — skipping message");
    return false;
  }

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${config.token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: config.chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: false,
        }),
      },
    );

    if (!res.ok) {
      const body = await res.text();
      console.error(`[TELEGRAM] Failed (${res.status}):`, body);
      return false;
    }

    console.log("[TELEGRAM] Message sent");
    return true;
  } catch (err) {
    console.error("[TELEGRAM] Error:", err);
    return false;
  }
}

// ─── Public API ───

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

  return sendMessage(text);
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

  return sendMessage(text);
}
