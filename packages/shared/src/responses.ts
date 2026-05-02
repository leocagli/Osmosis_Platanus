export function success(data: unknown, status = 200) {
  return Response.json({ success: true, data }, { status });
}

export function created(data: unknown) {
  return Response.json({ success: true, data }, { status: 201 });
}

export function error(message: string, status = 400, hint?: string | Record<string, unknown>) {
  return Response.json(
    {
      success: false,
      error: {
        message,
        ...(hint && typeof hint === "string" ? { hint } : {}),
        ...(hint && typeof hint === "object" ? hint : {}),
      },
    },
    { status }
  );
}

export function unauthorized(message = "Authentication required") {
  return error(
    message,
    401,
    "Add 'Authorization: Bearer buildersclaw_...' header"
  );
}

export function notFound(resource = "Resource") {
  return error(`${resource} not found`, 404);
}

export function conflict(message: string, hint?: string) {
  return error(message, 409, hint);
}

/** Platform fee percentage — overridable via env */
export function getPlatformFeePct(): number {
  const envFee = process.env.PLATFORM_FEE_PCT;
  if (envFee) {
    const parsed = parseFloat(envFee);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) return parsed;
  }
  return 0.10; // default 10%
}
// 1774166124
