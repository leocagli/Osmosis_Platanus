import { Resend } from "resend";

import { getBaseUrl } from "./config";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "BuildersClaw <noreply@buildersclaw.com>";

interface ApprovalEmailParams {
  to: string;
  company: string;
  hackathonTitle: string;
  hackathonUrl: string;
  judgeType: "platform" | "custom";
  judgeApiKey?: string;
}

/**
 * Send an email to the enterprise when their proposal is approved.
 * Includes hackathon link and, if custom judge, the judge API key.
 */
export async function sendApprovalEmail(params: ApprovalEmailParams): Promise<boolean> {
  if (!resend) {
    console.warn("[EMAIL] RESEND_API_KEY not configured — skipping email to", params.to);
    return false;
  }

  const { to, company, hackathonTitle, hackathonUrl, judgeType, judgeApiKey } = params;
  const fullUrl = `${getBaseUrl()}${hackathonUrl}`;

  const judgeSection = judgeType === "custom" && judgeApiKey
    ? `
      <div style="background:#1a1508;border:1px solid #3d3520;border-radius:8px;padding:20px;margin:24px 0;">
        <h3 style="color:#ffd700;font-size:14px;margin:0 0 12px;">⚖️ Your Judge API Key</h3>
        <p style="color:#ff6b6b;font-size:13px;font-weight:600;margin:0 0 12px;">⚠️ This key is shown ONLY ONCE. Save it now.</p>
        <div style="background:#0a0a0a;border:1px solid #3d3520;border-radius:6px;padding:14px;word-break:break-all;">
          <code style="color:#ffd700;font-size:13px;">${judgeApiKey}</code>
        </div>
        <p style="color:#999;font-size:12px;margin:16px 0 0;">
          Tell your judge agent to read the instructions at:<br/>
          <a href="${getBaseUrl()}/judge-skill.md" style="color:#4ade80;">
            ${getBaseUrl()}/judge-skill.md
          </a>
        </p>
      </div>`
    : `
      <div style="background:#081a08;border:1px solid #1a3d1a;border-radius:8px;padding:16px;margin:24px 0;">
        <p style="color:#4ade80;font-size:13px;margin:0;">
          ✅ The BuildersClaw AI Judge will automatically evaluate all submissions when the deadline passes.
        </p>
      </div>`;

  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:-apple-system,system-ui,sans-serif;color:#e0e0e0;background:#0a0a0a;padding:32px;border-radius:12px;">
      <div style="text-align:center;margin-bottom:24px;">
        <span style="font-size:32px;">🦞</span>
        <h1 style="font-size:24px;font-weight:700;margin:8px 0 0;">
          <span style="color:#fff;">Builders</span><span style="color:#ff6b35;">Claw</span>
        </h1>
      </div>

      <h2 style="color:#4ade80;font-size:18px;text-align:center;margin-bottom:8px;">
        ✓ Proposal Approved
      </h2>
      <p style="color:#999;text-align:center;font-size:14px;margin-bottom:24px;">
        ${company} — your hackathon is live!
      </p>

      <div style="background:#111;border:1px solid #222;border-radius:8px;padding:20px;margin-bottom:16px;">
        <div style="color:#999;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Hackathon</div>
        <div style="color:#fff;font-size:16px;font-weight:600;">${hackathonTitle}</div>
      </div>

      <div style="background:#111;border:1px solid #222;border-radius:8px;padding:20px;margin-bottom:16px;">
        <div style="color:#999;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Hackathon URL</div>
        <a href="${fullUrl}" style="color:#ff6b35;font-size:14px;word-break:break-all;">${fullUrl}</a>
      </div>

      ${judgeSection}

      <div style="text-align:center;margin-top:32px;">
        <a href="${fullUrl}" style="display:inline-block;padding:14px 32px;background:#ff6b35;color:#fff;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none;">
          View Your Hackathon
        </a>
      </div>

      <p style="color:#666;font-size:12px;text-align:center;margin-top:32px;">
        Builders will join, build their solutions in GitHub repos, and submit links before the deadline.
        ${judgeType === "custom" ? "Your judge agent evaluates submissions after the deadline." : "Our AI judge evaluates all code automatically."}
      </p>
    </div>
  `;

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: `✅ Your hackathon "${hackathonTitle}" is live — BuildersClaw`,
      html,
    });

    if (error) {
      console.error("[EMAIL] Failed to send:", error);
      return false;
    }

    console.log(`[EMAIL] Approval email sent to ${to}`);
    return true;
  } catch (err) {
    console.error("[EMAIL] Error sending email:", err);
    return false;
  }
}
