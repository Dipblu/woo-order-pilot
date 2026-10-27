// Rate-limit maths for Order Pilot.
//
// This is a second copy of logic that also lives inside two n8n Code nodes:
//   - "Compute Rate Limit Key"          -> getWindowKeys(), resolveIp()
//   - "Compute Sliding Window Estimate" -> slidingEstimate()
// and in the "Over Limit" If node                -> isOverLimit()
//
// n8n Code nodes cannot import from this repo, so the copies are kept in
// step by `npm run test:ratelimit-sync`, which reads the exported workflow
// JSON. n8n is the source of truth for behaviour.
//
// The clock is injected (`nowMs`) so tests can pin time. The n8n nodes call
// Date.now() directly.
//
// Keep this file free of n8n globals ($, $json, item).

export const WINDOW_MINUTES = 10;
export const LIMIT = 20;

export type WindowKeys = {
  windowStart: string; // ISO, start of the current fixed bucket
  previousWindowStart: string; // ISO, start of the bucket before it
};

/** Fixed bucket boundaries for `nowMs`. Mirrors "Compute Rate Limit Key". */
export function getWindowKeys(nowMs: number, windowMinutes: number = WINDOW_MINUTES): WindowKeys {
  const windowMs = windowMinutes * 60 * 1000;
  const bucket = Math.floor(nowMs / windowMs) * windowMs;
  return {
    windowStart: new Date(bucket).toISOString(),
    previousWindowStart: new Date(bucket - windowMs).toISOString(),
  };
}

/**
 * Which identifier a request is counted under. Mirrors "Compute Rate Limit Key".
 * x-real-ip wins (set by nginx, not spoofable by the caller); x-forwarded-for
 * is a fallback and takes the LAST hop; anything that is not an IP-shaped
 * string collapses to 'unknown'.
 */
export function resolveIp(headers: Record<string, string | undefined>): string {
  let ip: string =
    headers['x-real-ip'] || headers['x-forwarded-for']?.split(',').pop()?.trim() || 'unknown';
  if (!/^[0-9a-fA-F:.]{1,45}$/.test(ip)) ip = 'unknown';
  return ip;
}

export type EstimateInput = {
  currentCount: number; // request_count RETURNED by the upsert (includes this request)
  previousCount: number; // previous bucket's count, 0 if no row
  windowStart: string;
  previousWindowStart: string;
  nowMs: number;
};

/**
 * Sliding-window estimate. Mirrors "Compute Sliding Window Estimate".
 * The window length is DERIVED from the two keys, never restated, so it
 * cannot drift from getWindowKeys().
 */
export function slidingEstimate(i: EstimateInput): number {
  const windowStartMs = new Date(i.windowStart).getTime();
  const previousWindowStartMs = new Date(i.previousWindowStart).getTime();
  const windowMs = windowStartMs - previousWindowStartMs;

  const elapsedMs = i.nowMs - windowStartMs;
  const overlapFraction = Math.max(0, (windowMs - elapsedMs) / windowMs);

  return i.currentCount + i.previousCount * overlapFraction;
}

/** Mirrors the "Over Limit" If node: strictly greater than. */
export function isOverLimit(estimatedCount: number, limit: number = LIMIT): boolean {
  return estimatedCount > limit;
}
