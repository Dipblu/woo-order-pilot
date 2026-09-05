import { readFileSync } from 'node:fs';
import { ORDER_KEYWORDS, COMPLAINT_KEYWORDS } from '../lib/intent.js';

// Drift guard.
//
// src/lib/intent.ts is a second copy of logic that also lives inside the
// n8n "Classify Intent" node, because n8n Code nodes cannot import from
// this repo. Two copies drift silently — that is exactly the class of bug
// this project keeps hitting.
//
// This test reads the exported workflow JSON and asserts the parts most
// likely to be edited in the n8n UI still match intent.ts. It does not
// prove the whole node is identical; it proves the keyword lists and the
// extraction regexes are.

const WORKFLOW_PATH = 'n8n/rag-chat-workflow.json';
const NODE_NAME = 'Classify Intent';

function getNodeCode(): string {
  const wf = JSON.parse(readFileSync(WORKFLOW_PATH, 'utf8'));
  const node = (wf.nodes || []).find((n: any) => n.name === NODE_NAME);
  if (!node) throw new Error(`Node "${NODE_NAME}" not found in ${WORKFLOW_PATH}`);
  const code = node.parameters?.jsCode;
  if (!code) throw new Error(`Node "${NODE_NAME}" has no jsCode`);
  return code;
}

/** Pull a `const NAME = [ ... ];` array literal out of the node source. */
function extractArray(code: string, name: string): string[] {
  const start = code.indexOf(`const ${name} = [`);
  if (start === -1) throw new Error(`${name} not found in node code`);
  const open = code.indexOf('[', start);
  const close = code.indexOf('];', open);
  if (close === -1) throw new Error(`${name} array is not terminated`);
  const body = code.slice(open + 1, close);

  const items: string[] = [];
  const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    items.push((m[1] ?? m[2]).replace(/\\'/g, "'").replace(/\\"/g, '"'));
  }
  return items;
}

type Check = { name: string; run: (code: string) => string[] };

function compareLists(label: string, live: string[], canonical: string[]): string[] {
  const diffs: string[] = [];
  const liveSet = new Set(live);
  const canonSet = new Set(canonical);
  for (const k of canonical) if (!liveSet.has(k)) diffs.push(`missing from n8n: "${k}"`);
  for (const k of live) if (!canonSet.has(k)) diffs.push(`extra in n8n: "${k}"`);
  if (diffs.length === 0 && live.length !== canonical.length) {
    diffs.push(`${label} length differs: n8n ${live.length}, intent.ts ${canonical.length}`);
  }
  return diffs;
}

const CHECKS: Check[] = [
  {
    name: 'ORDER_KEYWORDS match intent.ts',
    run: (code) => compareLists('ORDER_KEYWORDS', extractArray(code, 'ORDER_KEYWORDS'), ORDER_KEYWORDS),
  },
  {
    name: 'COMPLAINT_KEYWORDS match intent.ts',
    run: (code) =>
      compareLists('COMPLAINT_KEYWORDS', extractArray(code, 'COMPLAINT_KEYWORDS'), COMPLAINT_KEYWORDS),
  },
  {
    name: 'email regex unchanged',
    run: (code) =>
      code.includes('/[\\w.+-]+@[\\w-]+\\.[\\w.-]+/') ? [] : ['email regex not found or changed'],
  },
  {
    name: 'order-number regexes unchanged',
    run: (code) => {
      const diffs: string[] = [];
      if (!code.includes('/order\\s*#?\\s*(\\d{2,8})/')) diffs.push('"order N" regex changed');
      if (!code.includes('/#(\\d{2,8})\\b/')) diffs.push('"#N" regex changed');
      if (!code.includes('/\\b(\\d{2,8})\\b/')) diffs.push('bare-digits regex changed');
      return diffs;
    },
  },
  {
    name: 'cancel-question exclusion still present',
    run: (code) =>
      code.includes("lower.includes('cancel')") ? [] : ['isCancelQuestion check missing or changed'],
  },
  {
    name: 'continuation still outranks fresh classification',
    run: (code) =>
      code.includes('if (isContinuation) intent = pendingIntent')
        ? []
        : ['continuation branch missing or reordered'],
  },
  {
    name: 'canonical question reference intact',
    run: (code) =>
      code.includes("$('Webhook - Chat').item.json.body?.question")
        ? []
        : ['webhook question reference changed — check for the bare $json bug'],
  },
];

function main() {
  const code = getNodeCode();
  let passed = 0;
  const failures: { name: string; diffs: string[] }[] = [];

  for (const check of CHECKS) {
    let diffs: string[];
    try {
      diffs = check.run(code);
    } catch (err: any) {
      diffs = [err.message];
    }
    if (diffs.length === 0) passed++;
    else failures.push({ name: check.name, diffs });
  }

  console.log(`\n${passed}/${CHECKS.length} passed\n`);

  if (failures.length > 0) {
    console.log('DRIFT DETECTED:\n');
    for (const { name, diffs } of failures) {
      console.log(name);
      for (const d of diffs) console.log(`  ${d}`);
      console.log('---');
    }
    console.log('The n8n node and src/lib/intent.ts disagree.');
    console.log('n8n is the source of truth for behaviour: re-export the workflow,');
    console.log('then update intent.ts and its tests to match.\n');
    process.exit(1);
  }
}

try {
  main();
} catch (err: any) {
  console.error('Sync test failed to run:', err.message);
  process.exit(1);
}
