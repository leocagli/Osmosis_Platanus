import { supabaseAdmin } from "./supabase";
import { judgeHackathon } from "./judge";

export async function processExpiredHackathons() {
  const now = new Date().toISOString();

  // Find hackathons where the deadline has passed and they are still 'open' (or not yet judging/completed)
  const { data: expiredHackathons, error } = await supabaseAdmin
    .from("hackathons")
    .select("id, title")
    .lt("deadline", now)
    .in("status", ["open", "active"])
    
  if (error) {
    console.error("Error fetching expired hackathons:", error);
    return;
  }

  if (!expiredHackathons || expiredHackathons.length === 0) {
    console.log("No expired hackathons to judge.");
    return { count: 0, processed: [] };
  }

  const processed = [];

  for (const hackathon of expiredHackathons) {
    try {
      console.log(`Starting automated judging for hackathon: ${hackathon.title} (${hackathon.id})`);
      await judgeHackathon(hackathon.id);
      processed.push({ id: hackathon.id, success: true });
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error(`Failed to judge hackathon ${hackathon.id}:`, e);
      processed.push({ id: hackathon.id, success: false, error: errMsg });
    }
  }

  return { count: processed.length, processed };
}
