import { URL } from "url";

export interface RuntimeCheckResult {
  url: string;
  status: "success" | "failed" | "timeout";
  http_status?: number;
  redirects: number;
  final_url?: string;
  page_title?: string;
  text_summary?: string;
  warnings: string[];
}

function isSafeUrl(urlStr: string): { safe: boolean; url?: URL; reason?: string } {
  try {
    const url = new URL(urlStr);
    
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { safe: false, reason: "Must be http or https" };
    }

    if (url.protocol === "http:" && process.env.ALLOW_LOCAL_RUNTIME_JUDGING !== "true") {
      return { safe: false, reason: "HTTP is only allowed for local dev" };
    }

    const host = url.hostname;
    
    // Check for IP addresses (simplified for basic checks)
    const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(host);
    if (isIp) {
      const parts = host.split(".").map(Number);
      if (
        parts[0] === 10 ||
        (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
        (parts[0] === 192 && parts[1] === 168) ||
        parts[0] === 127
      ) {
        if (process.env.ALLOW_LOCAL_RUNTIME_JUDGING !== "true") {
          return { safe: false, reason: "Private IP ranges are blocked" };
        }
      }
    } else {
      if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
        if (process.env.ALLOW_LOCAL_RUNTIME_JUDGING !== "true") {
          return { safe: false, reason: "Localhost and internal hostnames are blocked" };
        }
      }
    }

    return { safe: true, url };
  } catch {
    return { safe: false, reason: "Invalid URL format" };
  }
}

export async function checkDeploymentUrl(urlStr: string): Promise<RuntimeCheckResult> {
  const warnings: string[] = [];
  
  const { safe, url, reason } = isSafeUrl(urlStr);
  if (!safe || !url) {
    return {
      url: urlStr,
      status: "failed",
      redirects: 0,
      warnings: [reason || "Unsafe URL"],
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "BuildersClaw Runtime Judge Bot / 1.0",
      },
    });

    clearTimeout(timeoutId);

    const text = await response.text();
    const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
    const page_title = titleMatch ? titleMatch[1].trim() : undefined;

    // Very basic text summary: strip tags and get first 500 chars
    const stripped = text.replace(/<[^>]*>?/gm, " ").replace(/\s+/g, " ").trim();
    const text_summary = stripped.substring(0, 500);

    if (!response.ok) {
      warnings.push(`HTTP Status ${response.status}`);
    }

    if (text.length < 50) {
      warnings.push("Response body is unusually short or empty");
    }

    return {
      url: urlStr,
      status: response.ok ? "success" : "failed",
      http_status: response.status,
      redirects: response.redirected ? 1 : 0, // fetch API doesn't expose redirect count easily
      final_url: response.url,
      page_title,
      text_summary,
      warnings,
    };
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    if ((error as { name?: string }).name === "AbortError") {
      return {
        url: urlStr,
        status: "timeout",
        redirects: 0,
        warnings: ["Request timed out after 10 seconds"],
      };
    }

    const msg = error instanceof Error ? error.message : String(error);
    return {
      url: urlStr,
      status: "failed",
      redirects: 0,
      warnings: [`Network error: ${msg}`],
    };
  }
}