/**
 * ═══════════════════════════════════════════════════════════════
 * SANITIZE — Input sanitization utilities.
 *
 * Prevents XSS, HTML injection, and other input-based attacks.
 * ═══════════════════════════════════════════════════════════════
 */

/**
 * Escape HTML special characters to prevent XSS/injection.
 * Use before inserting user-controlled strings into HTML contexts
 * (e.g., Telegram HTML messages, email templates).
 */
export function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Strip all HTML tags from a string.
 * Use when you want plain text only — no formatting.
 */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

/**
 * Sanitize a string for use in SQL-like contexts.
 * Removes null bytes and control characters.
 */
export function sanitizeForStorage(input: string): string {
  return input
    // Remove null bytes (SQL injection vector)
    .replace(/\0/g, "")
    // Remove control characters except newline and tab
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

/**
 * Validate and sanitize a generic text field.
 * Trims, limits length, removes dangerous characters.
 */
export function sanitizeTextField(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;

  const cleaned = sanitizeForStorage(value.trim()).slice(0, maxLength);
  return cleaned || null;
}
