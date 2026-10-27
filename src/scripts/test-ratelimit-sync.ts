import { readFileSync } from 'node:fs';
import { LIMIT, WINDOW_MINUTES } from '../lib/ratelimit.js';

// Drift guard for the rate limiter.
//
// src/lib/ratelimit.ts is a second copy of logic that also lives in two n8n
// Code nodes, one If node and two Postgres nodes. This test reads the
// exported workflow JSON and asserts the parts most likely to be edited in
// the n8n UI still agree with ratelimit.ts.
//
// It exists because the limit and window were once defined in three places
// that nothing linked (see docs/CONFIG_INVENTORY.md, "Known defects"). The
// guard fails if a literal creeps back in.
//
// Usage: tsx src/scripts/test-ratelimit-sync.ts [path-to-workflow.json]

const WORKFLOW_PATH = process.argv[2] ?? 'n8n/rag-chat-workflow.json';

const KEY_NODE = 'Compute Rate Limit Key';
const ESTIMATE_NODE = 'Compute Sliding Window Estimate';
const OVER_LIMIT_NODE = 'Over Limit';
const UPSERT_NODE = 'Upsert Rate Limit';
const PREVIOUS_NODE = 'Get Previous Window Count';

const wf = JSON.parse(readFileSync(WORKFLOW_PATH, 'utf8'));

function node(name: string): any {
  const n = (wf.nodes || []).find((x: any) => x.name === name);
  if (!n) throw new Error(`Node "${name}" not found in ${WORKFLOW_PATH}`);
  return n;
}
function code(name: string): string {
  const c = node(name).parameters?.jsCode;
  if (!c) throw new Error(`Node "${name}" has no jsCode`);
  return c;
}
function sql(name: string): string {
  const q = node(name).parameters?.query;
  if (!q) throw new Error(`Node "${name}" has no query`);
  return q;
}
/** Whitespace-insensitive substring test, so reformatting does not trip it. */
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const has = (haystack: string, needle: string) => squash(haystack).includes(squash(needle));

type Check = { name: string; run: () => string[] };

const CHECKS: Check[] = [
  {
    name: `${KEY_NODE}: windowMinutes matches ratelimit.ts (${WINDOW_MINUTES})`,
    run: () => {
      const m = code(KEY_NODE).match(/const windowMinutes = (\d+);/);
      if (!m) return ['"const windowMinutes = N;" not found'];
      return Number(m[1]) === WINDOW_MINUTES ? [] : [`n8n has ${m[1]}, ratelimit.ts has ${WINDOW_MINUTES}`];
    },
  },
  {
    name: `${KEY_NODE}: emitted limit matches ratelimit.ts (${LIMIT})`,
    run: () => {
      const m = code(KEY_NODE).match(/\blimit:\s*(\d+)\b/);
      if (!m) return ['"limit: N" not found in the returned object'];
      return Number(m[1]) === LIMIT ? [] : [`n8n has ${m[1]}, ratelimit.ts has ${LIMIT}`];
    },
  },
  {
    name: `${KEY_NODE}: bucket and previous-bucket formulas unchanged`,
    run: () => {
      const c = code(KEY_NODE);
      const diffs: string[] = [];
      if (!has(c, 'const windowMs = windowMinutes * 60 * 1000;')) diffs.push('windowMs line changed');
      if (!has(c, 'new Date(Math.floor(Date.now() / windowMs) * windowMs).toISOString()'))
        diffs.push('windowStart formula changed');
      if (!has(c, 'new Date(Math.floor(Date.now() / windowMs) * windowMs - windowMs).toISOString()'))
        diffs.push('previousWindowStart formula changed');
      return diffs;
    },
  },
  {
    name: `${KEY_NODE}: IP resolution unchanged`,
    run: () => {
      const c = code(KEY_NODE);
      const diffs: string[] = [];
      if (!c.includes("headers['x-real-ip']")) diffs.push('x-real-ip no longer read');
      if (!has(c, "headers['x-forwarded-for']?.split(',').pop()?.trim()"))
        diffs.push('x-forwarded-for no longer takes the LAST hop');
      if (!c.includes('/^[0-9a-fA-F:.]{1,45}$/')) diffs.push('IP validation regex changed');
      if (!has(c, "ip = 'unknown'")) diffs.push("'unknown' fallback missing");
      return diffs;
    },
  },
  {
    name: `${ESTIMATE_NODE}: window length is derived, with no literal restated`,
    run: () => {
      const c = code(ESTIMATE_NODE);
      const diffs: string[] = [];
      if (!has(c, 'const windowMs = windowStartMs - previousWindowStartMs;'))
        diffs.push('windowMs is no longer derived from the two window keys');
      if (/60\s*\*\s*1000/.test(c)) diffs.push('a hardcoded "60 * 1000" is back in the estimate node');
      return diffs;
    },
  },
  {
    name: `${ESTIMATE_NODE}: overlap and estimate formulas match ratelimit.ts`,
    run: () => {
      const c = code(ESTIMATE_NODE);
      const diffs: string[] = [];
      if (!has(c, 'const elapsedMs = Date.now() - windowStartMs;')) diffs.push('elapsedMs line changed');
      if (!has(c, 'const overlapFraction = Math.max(0, (windowMs - elapsedMs) / windowMs);'))
        diffs.push('overlapFraction changed or lost its Math.max(0, ...) clamp');
      if (!has(c, 'const estimatedCount = currentCount + (previousCount * overlapFraction);'))
        diffs.push('estimatedCount formula changed');
      return diffs;
    },
  },
  {
    name: `${ESTIMATE_NODE}: forwards the limit from ${KEY_NODE}`,
    run: () =>
      has(code(ESTIMATE_NODE), "limit: $('Compute Rate Limit Key').item.json.limit")
        ? []
        : ['the returned object no longer carries limit from Compute Rate Limit Key'],
  },
  {
    name: `${OVER_LIMIT_NODE}: compares estimate > limit with no literal threshold`,
    run: () => {
      const conds = node(OVER_LIMIT_NODE).parameters?.conditions?.conditions ?? [];
      if (conds.length !== 1) return [`expected exactly 1 condition, found ${conds.length}`];
      const c = conds[0];
      const diffs: string[] = [];
      if (c.operator?.type !== 'number' || c.operator?.operation !== 'gt')
        diffs.push(`operator is ${c.operator?.type}/${c.operator?.operation}, expected number/gt`);
      if (!has(String(c.leftValue), "$('Compute Sliding Window Estimate').first().json.estimatedCount"))
        diffs.push('leftValue is not the sliding-window estimate');
      if (!has(String(c.rightValue), "$('Compute Sliding Window Estimate').first().json.limit"))
        diffs.push(`rightValue is ${JSON.stringify(c.rightValue)}, expected a reference to the estimate node's limit`);
      return diffs;
    },
  },
  {
    name: `${UPSERT_NODE}: atomic increment-and-return`,
    run: () => {
      const q = sql(UPSERT_NODE);
      const diffs: string[] = [];
      if (!/ON CONFLICT\s*\(identifier,\s*window_start\)/i.test(q)) diffs.push('ON CONFLICT (identifier, window_start) missing');
      if (!has(q.toLowerCase(), 'request_count = rate_limits.request_count + 1'))
        diffs.push('increment is no longer "request_count + 1"');
      if (!/RETURNING request_count/i.test(q)) diffs.push('RETURNING request_count missing');
      return diffs;
    },
  },
  {
    name: `${PREVIOUS_NODE}: missing row reads as 0 via COALESCE`,
    run: () => {
      const q = sql(PREVIOUS_NODE);
      const diffs: string[] = [];
      if (!/COALESCE\s*\(/i.test(q)) diffs.push('COALESCE missing: a first-ever window would return zero rows and kill the branch');
      if (!/,\s*0\s*\)\s*AS previous_count/i.test(q)) diffs.push('default of 0 AS previous_count missing');
      return diffs;
    },
  },
];

function main() {
  const failures: Array<{ name: string; diffs: string[] }> = [];
  for (const c of CHECKS) {
    let diffs: string[];
    try {
      diffs = c.run();
    } catch (err: any) {
      diffs = [`could not run: ${err.message}`];
    }
    if (diffs.length > 0) failures.push({ name: c.name, diffs });
  }

  console.log(`\n${CHECKS.length - failures.length}/${CHECKS.length} passed\n`);
  if (failures.length > 0) {
    console.log('DRIFT DETECTED:\n');
    for (const { name, diffs } of failures) {
      console.log(name);
      for (const d of diffs) console.log(`  ${d}`);
      console.log('---');
    }
    console.log('The n8n nodes and src/lib/ratelimit.ts disagree.');
    console.log('n8n is the source of truth for behaviour: re-export the workflow,');
    console.log('then update ratelimit.ts and its tests to match.\n');
    process.exit(1);
  }
}

try {
  main();
} catch (err: any) {
  console.error('Sync test failed to run:', err.message);
  process.exit(1);
}
