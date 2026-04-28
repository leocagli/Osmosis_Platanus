import { NextResponse, type NextRequest } from "next/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Next.js middleware — runs on every API request.
 * 
 * Security layers:
 * 1. Blocks browser-originated POSTs (sec-fetch-mode: navigate)
 * 2. Requires auth on all writes (except register)
 * 3. Validates UUID path params to prevent injection
 * 4. Adds security headers
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only guard /api/v1
  if (!pathname.startsWith("/api/v1")) return NextResponse.next();

  // ── Security headers on all API responses ──
  const response = NextResponse.next();
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "no-referrer");

  // ── Read requests: allow freely ──
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return response;

  // ── Block browser navigation POSTs ──
  const secFetchMode = req.headers.get("sec-fetch-mode");
  if (secFetchMode === "navigate") {
    return NextResponse.json(
      { success: false, error: { message: "This API is for AI agents only.", hint: "Read https://hackaclaw.vercel.app/skill.md for instructions." } },
      { status: 403 }
    );
  }

  // ── Auth required on all writes except public endpoints ──
  const isRegister = pathname.endsWith("/agents/register") && req.method === "POST";
  const isJudge = pathname.endsWith("/judge") && req.method === "POST";
  const isProposal = pathname.endsWith("/proposals") && req.method === "POST";
  const isPublicWrite = isRegister || isJudge || isProposal;

  if (!isPublicWrite) {
    const auth = req.headers.get("authorization");
    const isAdminRoute = pathname.startsWith("/api/v1/admin/");
    const hasValidAgentPrefix = !!auth && auth.startsWith("Bearer hackaclaw_");
    const hasBearerToken = !!auth && auth.startsWith("Bearer ");

    if ((!isAdminRoute && !hasValidAgentPrefix) || (isAdminRoute && !hasBearerToken)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            message: "Authentication required.",
            hint: isAdminRoute
              ? "Add 'Authorization: Bearer <ADMIN_API_KEY>' header."
              : "Register at POST /api/v1/agents/register to get your API key.",
          },
        },
        { status: 401 }
      );
    }
  }

  // ── Validate UUID params in path ──
  // Matches segments like /hackathons/UUID/teams/UUID/...
  const segments = pathname.replace("/api/v1/", "").split("/");
  for (const seg of segments) {
    // If it looks like it should be a UUID (contains dashes, 36 chars) but isn't valid, reject
    if (seg.length === 36 && seg.includes("-") && !UUID_RE.test(seg)) {
      return NextResponse.json(
        { success: false, error: { message: "Invalid ID format." } },
        { status: 400 }
      );
    }
  }

  // ── Request body size limit (256KB) ──
  const contentLength = req.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > 256 * 1024) {
    return NextResponse.json(
      { success: false, error: { message: "Request body too large. Max 256KB." } },
      { status: 413 }
    );
  }

  return response;
}

export const config = {
  matcher: "/api/v1/:path*",
};
