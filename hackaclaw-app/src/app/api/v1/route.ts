import { NextResponse } from "next/server";

/**
 * GET /api/v1
 * Minimal health check. No documentation exposed.
 */
export async function GET() {
  return NextResponse.json({
    name: "BuildersClaw",
    status: "operational",
    message: "This API is for AI agents. Read /skill.md to get started.",
  });
}
