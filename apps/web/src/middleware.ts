/**
 * ═══════════════════════════════════════════════════════════════
 * MIDDLEWARE — Security hardening for all API routes.
 *
 * Provides:
 *   - Security headers (HSTS, CSP, X-Frame-Options, etc.)
 *   - CORS control (only allowed origins)
 *   - Request body size enforcement
 *   - IP-based global rate limiting (edge-compatible)
 *   - Bot/abuse detection via User-Agent
 * ═══════════════════════════════════════════════════════════════
 */

import { NextRequest, NextResponse } from "next/server";

// ─── Configuration ───

const ALLOWED_ORIGINS = [
  "https://www.buildersclaw.xyz",
  "https://buildersclaw.xyz",
  "https://dev.buildersclaw.xyz",
  "https://www.buildersclaw.com",
  "https://buildersclaw.com",
  process.env.NEXT_PUBLIC_APP_URL,
  // Current Vercel deployment and branch preview URLs (injected per deployment)
  process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
  process.env.VERCEL_BRANCH_URL ? `https://${process.env.VERCEL_BRANCH_URL}` : null,
].filter(Boolean) as string[];

// In development, allow localhost
if (process.env.NODE_ENV !== "production") {
  ALLOWED_ORIGINS.push("http://localhost:3000", "http://localhost:3001", "http://127.0.0.1:3000");
}

// Match any Vercel preview URL for this project (buildersclaw-*-stevenmlx.vercel.app)
function isVercelPreviewOrigin(origin: string): boolean {
  return /^https:\/\/buildersclaw[a-z0-9-]*\.vercel\.app$/.test(origin);
}

/** Max request body size: 1MB for most routes, 256KB for chat */
const MAX_BODY_SIZE_BYTES = 1 * 1024 * 1024;
const MAX_CHAT_BODY_SIZE = 256 * 1024;

/**
 * Global rate limiter — edge-compatible (Map-based).
 * NOTE: In Vercel Edge, this is per-isolate. For production, use Vercel KV or Upstash Redis.
 * This still provides meaningful protection against single-origin bursts.
 */
const globalRateLimits = new Map<string, { count: number; windowStart: number }>();
const GLOBAL_RATE_LIMIT = 300; // requests per window
const GLOBAL_RATE_WINDOW_MS = 60_000; // 1 minute

function checkGlobalRateLimit(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = globalRateLimits.get(ip);

  if (!entry || now - entry.windowStart > GLOBAL_RATE_WINDOW_MS) {
    globalRateLimits.set(ip, { count: 1, windowStart: now });
    return { allowed: true, remaining: GLOBAL_RATE_LIMIT - 1 };
  }

  if (entry.count >= GLOBAL_RATE_LIMIT) {
    return { allowed: false, remaining: 0 };
  }

  entry.count++;
  return { allowed: true, remaining: GLOBAL_RATE_LIMIT - entry.count };
}

// Cleanup stale entries periodically
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of globalRateLimits) {
      if (now - entry.windowStart > GLOBAL_RATE_WINDOW_MS * 2) {
        globalRateLimits.delete(key);
      }
    }
  }, 60_000);
}

// ─── Security Headers ───

function applySecurityHeaders(response: NextResponse, isApi: boolean): void {
  // Prevent clickjacking
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Content-Security-Policy", "frame-ancestors 'none'");

  // Prevent MIME sniffing
  response.headers.set("X-Content-Type-Options", "nosniff");

  // XSS Protection (legacy browsers)
  response.headers.set("X-XSS-Protection", "1; mode=block");

  // Referrer Policy
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  // HSTS (1 year, includeSubDomains)
  if (process.env.NODE_ENV === "production") {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload"
    );
  }

  // Permissions Policy — disable dangerous features
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()"
  );

  // API responses: never cache (sensitive data)
  // Pages: let Next.js handle caching normally for performance
  if (isApi) {
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    response.headers.set("Pragma", "no-cache");
  }
}

// ─── CORS ───

function handleCors(request: NextRequest, response: NextResponse): NextResponse {
  const origin = request.headers.get("origin");

  // API routes need proper CORS
  if (request.nextUrl.pathname.startsWith("/api/")) {
    // For agent API calls (Bearer token auth), allow any origin
    // because AI agents make requests from various servers
    const hasAuth = request.headers.has("authorization");

    if (hasAuth) {
      // Authenticated API calls — allow from any origin (agents are server-side)
      response.headers.set("Access-Control-Allow-Origin", origin || "*");
    } else if (origin && (ALLOWED_ORIGINS.includes(origin) || isVercelPreviewOrigin(origin))) {
      // Browser requests — only from allowed origins (including Vercel previews)
      response.headers.set("Access-Control-Allow-Origin", origin);
    } else if (!origin) {
      // No origin header (server-to-server, curl, etc.) — allow
      response.headers.set("Access-Control-Allow-Origin", "*");
    } else {
      // Unknown browser origin — reject
      return new NextResponse(JSON.stringify({ error: "CORS: Origin not allowed" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Seed-Secret, X-Telegram-Bot-Api-Secret-Token");
    response.headers.set("Access-Control-Max-Age", "86400");
    response.headers.set("Access-Control-Allow-Credentials", "true");
  }

  return response;
}

// ─── Main Middleware ───

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── Preflight (OPTIONS) — fast path ──
  if (request.method === "OPTIONS") {
    const response = new NextResponse(null, { status: 204 });
    applySecurityHeaders(response, true);
    return handleCors(request, response);
  }

  // ── Global rate limiting (API routes only) ──
  if (pathname.startsWith("/api/")) {
    const clientIp =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";

    const rateCheck = checkGlobalRateLimit(clientIp);

    if (!rateCheck.allowed) {
      const response = NextResponse.json(
        {
          success: false,
          error: {
            message: "Too many requests. Please slow down.",
            retry_after_seconds: 60,
          },
        },
        { status: 429 }
      );
      response.headers.set("Retry-After", "60");
      applySecurityHeaders(response, true);
      return response;
    }

    // ── Request body size check ──
    const contentLength = request.headers.get("content-length");
    if (contentLength) {
      const size = parseInt(contentLength, 10);
      const maxSize = pathname.includes("/chat") ? MAX_CHAT_BODY_SIZE : MAX_BODY_SIZE_BYTES;

      if (!isNaN(size) && size > maxSize) {
        const response = NextResponse.json(
          {
            success: false,
            error: {
              message: `Request body too large. Maximum: ${Math.round(maxSize / 1024)}KB`,
            },
          },
          { status: 413 }
        );
        applySecurityHeaders(response, true);
        return response;
      }
    }

    // ── Content-Type validation for POST/PUT/PATCH ──
    if (["POST", "PUT", "PATCH"].includes(request.method)) {
      const contentType = request.headers.get("content-type");

      // Telegram webhook sends application/json always
      // Allow missing content-type for simple requests
      if (contentType && !contentType.includes("application/json") && !contentType.includes("multipart/form-data")) {
        const response = NextResponse.json(
          {
            success: false,
            error: {
              message: "Unsupported Content-Type. Use application/json.",
            },
          },
          { status: 415 }
        );
        applySecurityHeaders(response, true);
        return response;
      }
    }

    // ── Block suspicious user-agents ──
    const ua = request.headers.get("user-agent") || "";
    const suspiciousPatterns = [
      /sqlmap/i, /nikto/i, /nessus/i, /masscan/i,
      /zgrab/i, /nuclei/i, /dirbuster/i, /gobuster/i,
    ];

    if (suspiciousPatterns.some((p) => p.test(ua))) {
      return new NextResponse(null, { status: 403 });
    }
  }

  // ── Continue with response + headers ──
  const isApiRoute = pathname.startsWith("/api/");
  const response = NextResponse.next();
  applySecurityHeaders(response, isApiRoute);

  if (isApiRoute) {
    return handleCors(request, response);
  }

  return response;
}

export const config = {
  matcher: [
    // API routes
    "/api/:path*",
    // Pages (for security headers)
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
