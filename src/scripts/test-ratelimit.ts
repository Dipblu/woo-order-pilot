import {
  LIMIT,
  WINDOW_MINUTES,
  getWindowKeys,
  isOverLimit,
  resolveIp,
  slidingEstimate,
} from '../lib/ratelimit.js';

// Regression suite for the rate limiter's maths.
//
// Pure functions + an in-memory stand-in for the rate_limits table, with the
// clock pinned. It proves the FORMULA. It does not prove the SQL: the
// `INSERT ... ON CONFLICT DO UPDATE` atomicity and the `COALESCE(..., 0)` on
// the previous-window read need a real Postgres. See docs/TESTING.md.
//
// Cases tagged QUIRK document behaviour that is correct-by-design but
// surprising. Do not "fix" one without deciding it on purpose.

const MIN = 60 * 1000;
const WINDOW_MS = WINDOW_MINUTES * MIN;
// 2026-09-14 12:00:00 UTC, an exact multiple of 10 minutes.
const T0 = Date.UTC(2026, 8, 14, 12, 0, 0);

/** Stand-in for the rate_limits table: (identifier, window_start) -> count. */
class FakeTable {
  private rows = new Map<string, number>();

  /** One request through the whole limiter, in the same order as the workflow. */
  request(ip: string, nowMs: number, windowMinutes: number = WINDOW_MINUTES) {
    const { windowStart, previousWindowStart } = getWindowKeys(nowMs, windowMinutes);
    // Upsert Rate Limit: increments BEFORE the check, so blocked requests count too.
    const currentCount = (this.rows.get(`${ip}|${windowStart}`) ?? 0) + 1;
    this.rows.set(`${ip}|${windowStart}`, currentCount);
    // Get Previous Window Count: COALESCE(..., 0)
    const previousCount = this.rows.get(`${ip}|${previousWindowStart}`) ?? 0;
    const estimate = slidingEstimate({ currentCount, previousCount, windowStart, previousWindowStart, nowMs });
    return { estimate, blocked: isOverLimit(estimate) };
  }

  seed(ip: string, windowStart: number, count: number) {
    this.rows.set(`${ip}|${new Date(windowStart).toISOString()}`, count);
  }
}

type TestCase = { name: string; run: () => string | null }; // null = pass, string = failure reason

function eq(actual: unknown, expected: unknown, what: string): string | null {
  return Object.is(actual, expected) ? null : `${what}: expected ${String(expected)}, got ${String(actual)}`;
}
function near(actual: number, expected: number, what: string): string | null {
  return Math.abs(actual - expected) < 1e-9 ? null : `${what}: expected ~${expected}, got ${actual}`;
}
function first(...results: Array<string | null>): string | null {
  return results.find((r) => r !== null) ?? null;
}

const TESTS: TestCase[] = [
  // --- the headline behaviour ---
  {
    name: 'requests 1-20 pass, the 21st is blocked (empty previous window)',
    run: () => {
      const db = new FakeTable();
      for (let n = 1; n <= 20; n++) {
        const r = db.request('1.1.1.1', T0 + n * 1000);
        if (r.blocked) return `request ${n} was blocked, estimate ${r.estimate}`;
      }
      return eq(db.request('1.1.1.1', T0 + 21_000).blocked, true, 'request 21 blocked');
    },
  },
  {
    name: 'limit is strictly greater-than: an estimate of exactly 20 passes',
    run: () => first(eq(isOverLimit(20), false, 'isOverLimit(20)'), eq(isOverLimit(20.0001), true, 'isOverLimit(20.0001)')),
  },
  {
    name: 'different IPs are counted independently',
    run: () => {
      const db = new FakeTable();
      for (let n = 1; n <= 25; n++) db.request('1.1.1.1', T0 + n * 1000);
      return eq(db.request('2.2.2.2', T0 + 30_000).blocked, false, 'second IP blocked');
    },
  },
  {
    name: 'QUIRK: blocked requests still count, so hammering extends the block',
    run: () => {
      const db = new FakeTable();
      for (let n = 1; n <= 100; n++) db.request('1.1.1.1', T0 + 1000 + n);
      // 100 recorded in window 0. Early in window 1 the previous count still weighs ~1.0.
      const early = db.request('1.1.1.1', T0 + WINDOW_MS + 1000);
      return eq(early.blocked, true, 'blocked right after the boundary');
    },
  },
  {
    name: 'QUIRK: a 100-request spammer is only released ~80% into the next window',
    run: () => {
      // previous=100, current=1 -> 1 + 100*overlap <= 20  <=>  overlap <= 0.19  <=>  elapsed >= 81%
      const at = (pct: number) => {
        const db = new FakeTable();
        db.seed('1.1.1.1', T0, 100);
        return db.request('1.1.1.1', T0 + WINDOW_MS + Math.round(WINDOW_MS * pct));
      };
      return first(eq(at(0.79).blocked, true, 'blocked at 79%'), eq(at(0.81).blocked, false, 'allowed at 81%'));
    },
  },

  // --- sliding-window overlap maths (the part never proven in production) ---
  {
    name: 'overlap: at the very start of a window the previous count counts in full',
    run: () => {
      const { windowStart, previousWindowStart } = getWindowKeys(T0 + WINDOW_MS);
      const e = slidingEstimate({ currentCount: 3, previousCount: 10, windowStart, previousWindowStart, nowMs: T0 + WINDOW_MS });
      return near(e, 13, 'estimate');
    },
  },
  {
    name: 'overlap: halfway through, the previous count is weighted 0.5',
    run: () => {
      const now = T0 + WINDOW_MS + WINDOW_MS / 2;
      const { windowStart, previousWindowStart } = getWindowKeys(now);
      return first(
        near(slidingEstimate({ currentCount: 10, previousCount: 10, windowStart, previousWindowStart, nowMs: now }), 15, 'previous 10, current 10'),
        eq(isOverLimit(slidingEstimate({ currentCount: 11, previousCount: 20, windowStart, previousWindowStart, nowMs: now })), true, 'previous 20, current 11 should block (21)'),
      );
    },
  },
  {
    name: 'overlap: one millisecond before the next boundary the previous count is ~0',
    run: () => {
      const now = T0 + 2 * WINDOW_MS - 1;
      const { windowStart, previousWindowStart } = getWindowKeys(now);
      const e = slidingEstimate({ currentCount: 5, previousCount: 20, windowStart, previousWindowStart, nowMs: now });
      return e > 5 && e < 5.001 ? null : `expected just above 5, got ${e}`;
    },
  },
  {
    name: 'overlap is clamped at 0: a stale windowStart never goes negative',
    run: () => {
      // elapsed = 2.5 windows. Unclamped, overlap would be -1.5 and estimate would go BELOW currentCount.
      const { windowStart, previousWindowStart } = getWindowKeys(T0);
      const e = slidingEstimate({ currentCount: 4, previousCount: 20, windowStart, previousWindowStart, nowMs: T0 + 2.5 * WINDOW_MS });
      return near(e, 4, 'estimate');
    },
  },
  {
    name: 'no previous row (COALESCE -> 0) behaves like a fixed window',
    run: () => {
      const db = new FakeTable();
      return near(db.request('9.9.9.9', T0 + 5000).estimate, 1, 'estimate');
    },
  },

  // --- the boundary-burst problem the sliding window exists to solve ---
  {
    name: 'boundary burst: 20 requests just before a boundary, the first just after is blocked',
    run: () => {
      const db = new FakeTable();
      for (let n = 0; n < 20; n++) db.request('1.1.1.1', T0 + WINDOW_MS - 1000 + n);
      const after = db.request('1.1.1.1', T0 + WINDOW_MS + 1000);
      // A plain fixed window would count this as request 1 of 20 and allow it.
      return first(eq(after.blocked, true, 'blocked after boundary'), eq(1 <= LIMIT, true, 'fixed window would have allowed'));
    },
  },
  {
    name: 'boundary: a quiet previous window does not penalise the next one',
    run: () => {
      const db = new FakeTable();
      db.seed('1.1.1.1', T0, 2);
      return eq(db.request('1.1.1.1', T0 + WINDOW_MS + 1000).blocked, false, 'blocked');
    },
  },

  // --- window length is derived, not restated ---
  {
    name: 'window length follows windowMinutes (5 and 30), no hardcoded 10',
    run: () => {
      for (const minutes of [5, 30]) {
        const ms = minutes * MIN;
        const now = T0 + ms + ms / 2;
        const { windowStart, previousWindowStart } = getWindowKeys(now, minutes);
        const e = slidingEstimate({ currentCount: 0, previousCount: 10, windowStart, previousWindowStart, nowMs: now });
        const r = near(e, 5, `${minutes}-minute window, halfway`);
        if (r) return r;
      }
      return null;
    },
  },

  // --- bucket boundaries ---
  {
    name: 'getWindowKeys: previous bucket is exactly one window earlier, ISO strings',
    run: () => {
      const k = getWindowKeys(T0 + 123_456);
      return first(
        eq(k.windowStart, '2026-09-14T12:00:00.000Z', 'windowStart'),
        eq(k.previousWindowStart, '2026-09-14T11:50:00.000Z', 'previousWindowStart'),
      );
    },
  },
  {
    name: 'getWindowKeys: exactly on a boundary belongs to the NEW bucket',
    run: () => {
      const onBoundary = getWindowKeys(T0 + WINDOW_MS);
      const justBefore = getWindowKeys(T0 + WINDOW_MS - 1);
      return first(
        eq(onBoundary.windowStart, '2026-09-14T12:10:00.000Z', 'on boundary'),
        eq(justBefore.windowStart, '2026-09-14T12:00:00.000Z', '1ms before boundary'),
      );
    },
  },

  // --- who gets counted ---
  {
    name: 'resolveIp: x-real-ip wins over x-forwarded-for',
    run: () => eq(resolveIp({ 'x-real-ip': '203.0.113.9', 'x-forwarded-for': '6.6.6.6' }), '203.0.113.9', 'ip'),
  },
  {
    name: 'resolveIp: x-forwarded-for fallback takes the LAST hop, not the first',
    run: () => eq(resolveIp({ 'x-forwarded-for': '6.6.6.6, 10.0.0.1,  203.0.113.9 ' }), '203.0.113.9', 'ip'),
  },
  {
    name: "resolveIp: no headers -> 'unknown'",
    run: () => eq(resolveIp({}), 'unknown', 'ip'),
  },
  {
    name: "resolveIp: non-IP junk (SQL-shaped, spaces, too long) collapses to 'unknown'",
    run: () =>
      first(
        eq(resolveIp({ 'x-real-ip': "1.1.1.1'; DROP TABLE rate_limits;--" }), 'unknown', 'sql-shaped'),
        eq(resolveIp({ 'x-real-ip': 'not an ip' }), 'unknown', 'spaces'),
        eq(resolveIp({ 'x-real-ip': '1'.repeat(46) }), 'unknown', '46 chars'),
      ),
  },
  {
    name: 'resolveIp: IPv6 is accepted',
    run: () => eq(resolveIp({ 'x-real-ip': '2001:db8::1' }), '2001:db8::1', 'ip'),
  },
  {
    name: "QUIRK: every header-less request shares ONE 'unknown' bucket",
    run: () => {
      const db = new FakeTable();
      for (let n = 1; n <= 20; n++) db.request(resolveIp({}), T0 + n * 1000);
      return eq(db.request(resolveIp({}), T0 + 30_000).blocked, true, 'second anonymous caller blocked');
    },
  },
];

function main() {
  const failures: Array<{ name: string; reason: string }> = [];
  for (const t of TESTS) {
    let reason: string | null;
    try {
      reason = t.run();
    } catch (err: any) {
      reason = `threw: ${err.message}`;
    }
    if (reason !== null) failures.push({ name: t.name, reason });
  }

  console.log(`\n${TESTS.length - failures.length}/${TESTS.length} passed\n`);
  if (failures.length > 0) {
    for (const f of failures) console.log(`FAIL  ${f.name}\n      ${f.reason}\n`);
    process.exit(1);
  }
}

main();
