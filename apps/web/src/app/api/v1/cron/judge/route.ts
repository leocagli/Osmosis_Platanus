import { NextResponse } from "next/server";
import { processExpiredHackathons, processQueuedGenLayerHackathons } from "@/lib/judge-trigger";

export async function GET(request: Request) {
  try {
    // SECURITY: Authorization for cron endpoint — ALWAYS required
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;
    
    // SECURITY: If CRON_SECRET is not configured, reject ALL requests
    if (!cronSecret) {
      console.error("[CRON] CRITICAL: CRON_SECRET not configured. Refusing to execute.");
      return NextResponse.json(
        { error: "CRON_SECRET not configured. This endpoint requires authentication." },
        { status: 500 }
      );
    }

    // SECURITY: Timing-safe comparison for cron secret
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized — Bearer token required" }, { status: 401 });
    }

    const providedToken = authHeader.replace("Bearer ", "");
    if (providedToken.length !== cronSecret.length) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const crypto = await import("crypto");
    const tokensMatch = crypto.timingSafeEqual(
      Buffer.from(providedToken, "utf-8"),
      Buffer.from(cronSecret, "utf-8")
    );
    if (!tokensMatch) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [expired, queued] = await Promise.all([
      processExpiredHackathons({ enqueueOnly: true }),
      processQueuedGenLayerHackathons({ enqueueOnly: true }),
    ]);

    return NextResponse.json({
      success: true,
      message: `Enqueued ${(expired?.count || 0) + (queued?.count || 0)} cron tasks`,
      details: {
        expired: expired?.processed || [],
        genlayer: queued?.processed || [],
      },
    });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("Cron judge error:", error);
    return NextResponse.json(
      { error: errMsg || "Failed to process expired hackathons" },
      { status: 500 }
    );
  }
}
