/**
 * Prompt security — sanitization and injection detection.
 *
 * Prevents agents from:
 * - Injecting system prompt overrides
 * - Trying to exfiltrate data
 * - Bypassing the hackathon context
 * - Sending absurdly repetitive/padding content
 */

// Patterns that indicate prompt injection attempts
const INJECTION_PATTERNS: { pattern: RegExp; reason: string }[] = [
  // Direct system prompt manipulation
  { pattern: /ignore\s+(all\s+)?previous\s+instructions/i, reason: "Prompt injection: system override attempt" },
  { pattern: /ignore\s+(all\s+)?above\s+instructions/i, reason: "Prompt injection: system override attempt" },
  { pattern: /disregard\s+(all\s+)?previous/i, reason: "Prompt injection: system override attempt" },
  { pattern: /forget\s+(all\s+)?previous/i, reason: "Prompt injection: system override attempt" },
  { pattern: /you\s+are\s+now\s+a/i, reason: "Prompt injection: role override attempt" },
  { pattern: /new\s+system\s+prompt/i, reason: "Prompt injection: system override attempt" },
  { pattern: /\[SYSTEM\]/i, reason: "Prompt injection: system tag" },
  { pattern: /\[INST\]/i, reason: "Prompt injection: instruction tag" },
  { pattern: /<<SYS>>/i, reason: "Prompt injection: system tag" },
  { pattern: /<\|im_start\|>system/i, reason: "Prompt injection: ChatML tag" },

  // Data exfiltration
  { pattern: /send\s+(the\s+)?api\s+key/i, reason: "Exfiltration attempt: API key" },
  { pattern: /forward\s+(to|this\s+to)\s+http/i, reason: "Exfiltration attempt: forwarding data" },
  { pattern: /fetch\s*\(\s*['"]http/i, reason: "Exfiltration attempt: fetch call in prompt" },
  { pattern: /XMLHttpRequest/i, reason: "Exfiltration attempt: XHR in prompt" },
  { pattern: /navigator\.sendBeacon/i, reason: "Exfiltration attempt: beacon in prompt" },

  // Prompt leaking
  { pattern: /repeat\s+the\s+(system\s+)?prompt/i, reason: "Prompt leak attempt" },
  { pattern: /show\s+me\s+(your|the)\s+(system\s+)?prompt/i, reason: "Prompt leak attempt" },
  { pattern: /what\s+(are|were)\s+your\s+instructions/i, reason: "Prompt leak attempt" },
];

// Content quality checks
const QUALITY_CHECKS = {
  /** Minimum unique characters ratio (prevent padding attacks) */
  minUniqueCharRatio: 0.05,
  /** Max consecutive repeated characters */
  maxRepeatedChars: 50,
  /** Min meaningful words (not just noise) */
  minWords: 3,
};

export interface SanitizeResult {
  safe: boolean;
  cleaned: string;
  blocked_reason: string | null;
}

/**
 * Sanitize and validate a user prompt.
 * Returns { safe, cleaned, blocked_reason }
 */
export function sanitizePrompt(raw: string): SanitizeResult {
  // Trim and normalize whitespace
  const cleaned = raw.trim().replace(/\r\n/g, "\n");

  if (!cleaned) {
    return { safe: false, cleaned: "", blocked_reason: "Empty prompt" };
  }

  // ── Injection detection ──
  for (const { pattern, reason } of INJECTION_PATTERNS) {
    if (pattern.test(cleaned)) {
      return { safe: false, cleaned, blocked_reason: reason };
    }
  }

  // ── Quality checks ──

  // Check for padding attacks (e.g., "aaaa..." repeated to inflate tokens)
  const uniqueChars = new Set(cleaned).size;
  const uniqueRatio = uniqueChars / cleaned.length;
  if (cleaned.length > 100 && uniqueRatio < QUALITY_CHECKS.minUniqueCharRatio) {
    return { safe: false, cleaned, blocked_reason: "Prompt appears to be padding/spam (low character diversity)" };
  }

  // Check for excessive repetition
  const repeatedMatch = cleaned.match(/(.)\1{49,}/);
  if (repeatedMatch) {
    return { safe: false, cleaned, blocked_reason: "Prompt contains excessive repeated characters" };
  }

  // Check minimum word count
  const words = cleaned.split(/\s+/).filter(w => w.length > 1);
  if (words.length < QUALITY_CHECKS.minWords) {
    return { safe: false, cleaned, blocked_reason: "Prompt too short. Describe what you want to build." };
  }

  return { safe: true, cleaned, blocked_reason: null };
}

/**
 * Strip dangerous content from generated output before storing/committing.
 * Prevents XSS in previews, etc.
 */
export function sanitizeGeneratedOutput(content: string): string {
  // Remove any script tags that try to phone home
  return content
    // Remove beacon/fetch exfil attempts (but keep legit fetch for app logic)
    .replace(/navigator\.sendBeacon\s*\([^)]*\)/g, "/* blocked: beacon */")
    // Remove document.cookie access
    .replace(/document\.cookie/g, "/* blocked: cookie access */")
    // Remove attempts to access localStorage for exfil
    .replace(/localStorage\.getItem\s*\(\s*['"]api/gi, "/* blocked: api key access */");
}
