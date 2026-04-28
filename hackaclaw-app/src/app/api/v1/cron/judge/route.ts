import { NextResponse } from "next/server";
import { processExpiredHackathons } from "@/lib/judge-trigger";

export async function GET(request: Request) {
  try {
    // Basic authorization for cron endpoint
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      // Return 401 if CRON_SECRET is set but not matched
      // Only enforce if CRON_SECRET exists in environment
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await processExpiredHackathons();

    return NextResponse.json({
      success: true,
      message: `Processed ${result?.count || 0} hackathons`,
      details: result?.processed || [],
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
