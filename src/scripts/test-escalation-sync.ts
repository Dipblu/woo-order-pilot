import { readFileSync } from 'node:fs';

// Drift guard for the escalation path.
//
// The escalation path has regressed silently more than once:
//   - Gmail OAuth refresh tokens expired every 7 days while n8n still said
//     "Account connected", so escalation emails stopped with no error.
//   - A missing "=" prefix turned `fromEmail` into the literal text
//     "{{ $('Config')... }}" instead of an expression (fixed in afb29ff).
//   - The Telegram failure alert sat in series with the customer reply, so a
//     Telegram failure could swallow the reply (fixed in d3261b7).
//   - A stale export brought old nodes back.
// `test:intent-sync` only guards the keyword lists, so none of these were
// caught. This reads the exported workflow JSON and asserts the structure.
//
// It checks STRUCTURE, not delivery. Whether SMTP actually sends needs a live
// credential and is covered by sending a real complaint (docs/OPERATIONS.md).
//
// Usage: tsx src/scripts/test-escalation-sync.ts [path-to-workflow.json]

const WORKFLOW_PATH = process.argv[2] ?? 'n8n/rag-chat-workflow.json';

const wf = JSON.parse(readFileSync(WORKFLOW_PATH, 'utf8'));
const NODES: any[] = wf.nodes || [];
const CONNECTIONS: Record<string, any> = wf.connections || {};

const FAILED_REPLY = 'Escalation Failed Response';

/** Each escalation email node and where its SUCCESS output must go. */
const EMAIL_NODES: Array<{ name: string; successTo: string }> = [
  { name: 'Send Escalation Email', successTo: 'Escalation Stub' },
  { name: 'Send Escalation Email (Complaint)', successTo: 'Format Combined Response' },
];

function node(name: string): any {
  const n = NODES.find((x) => x.name === name);
  if (!n) throw new Error(`Node "${name}" not found in ${WORKFLOW_PATH}`);
  return n;
}

/** Target node names for one output index (0 = success / first, 1 = error). */
function targets(name: string, outputIndex: number): string[] {
  const out = CONNECTIONS[name]?.main?.[outputIndex] ?? [];
  return out.map((c: any) => c.node);
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const has = (haystack: string, needle: string) => squash(haystack).includes(squash(needle));

type Check = { name: string; run: () => string[] };

/** Run `fn` for each email node and prefix its findings with the node name. */
function perEmailNode(fn: (n: any, cfg: { name: string; successTo: string }) => string[]): string[] {
  return EMAIL_NODES.flatMap((cfg) => fn(node(cfg.name), cfg).map((d) => `${cfg.name}: ${d}`));
}

const CHECKS: Check[] = [
  {
    name: 'No Gmail nodes, Gmail OAuth credentials or "OLD" leftovers anywhere',
    run: () => {
      const diffs: string[] = [];
      for (const n of NODES) {
        if (/gmail/i.test(n.type)) diffs.push(`"${n.name}" is a Gmail node (${n.type})`);
        if (n.credentials?.gmailOAuth2) diffs.push(`"${n.name}" carries a gmailOAuth2 credential`);
        if (/gmail|\bOLD\b/i.test(n.name)) diffs.push(`"${n.name}" looks like a leftover node`);
      }
      return diffs;
    },
  },
  {
    name: 'Both escalation emails are SMTP (emailSend + smtp credential)',
    run: () =>
      perEmailNode((n) => {
        const diffs: string[] = [];
        if (n.type !== 'n8n-nodes-base.emailSend') diffs.push(`type is ${n.type}, expected n8n-nodes-base.emailSend`);
        if (!n.credentials?.smtp) diffs.push('no smtp credential attached');
        return diffs;
      }),
  },
  {
    name: 'From / To / Subject are expressions that read Config (no "=" prefix lost, nothing hardcoded)',
    run: () =>
      perEmailNode((n) => {
        const p = n.parameters ?? {};
        const diffs: string[] = [];
        const want: Array<[string, string]> = [
          ['fromEmail', "$('Config').item.json.fromEmail"],
          ['toEmail', "$('Config').item.json.escalationEmail"],
          ['subject', "$('Config').item.json.businessName"],
        ];
        for (const [field, ref] of want) {
          const v = String(p[field] ?? '');
          if (!v.startsWith('=')) diffs.push(`${field} has no leading "=", so n8n sends it as literal text: ${JSON.stringify(v)}`);
          else if (!has(v, ref)) diffs.push(`${field} no longer reads ${ref}: ${JSON.stringify(v)}`);
        }
        // Belt and braces: no literal address in any parameter, outside {{ }}.
        for (const [field, val] of Object.entries(p)) {
          if (typeof val !== 'string') continue;
          const outsideExpr = val.replace(/\{\{[\s\S]*?\}\}/g, '');
          if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(outsideExpr)) diffs.push(`${field} contains a hardcoded email address`);
        }
        return diffs;
      }),
  },
  {
    name: 'Email body takes its timestamp zone from Config (not a literal zone)',
    run: () =>
      perEmailNode((n) => {
        const t = String(n.parameters?.text ?? '');
        const diffs: string[] = [];
        if (!t.startsWith('=')) diffs.push('text has no leading "="');
        if (!has(t, "$now.setZone($('Config').item.json.timezone)")) diffs.push('timestamp no longer uses Config timezone');
        if (/setZone\(\s*['"]/.test(t)) diffs.push('a literal time zone is back in the body');
        return diffs;
      }),
  },
  {
    name: 'Both emails degrade honestly: On Error = "Continue (using error output)"',
    run: () =>
      perEmailNode((n) =>
        n.onError === 'continueErrorOutput'
          ? []
          : [`onError is ${JSON.stringify(n.onError)}; a failed send would stop the run or look like success`],
      ),
  },
  {
    name: `Both emails: success output -> the right reply, error output -> ${FAILED_REPLY}`,
    run: () =>
      perEmailNode((n, cfg) => {
        const diffs: string[] = [];
        const ok = targets(cfg.name, 0);
        const err = targets(cfg.name, 1);
        if (!ok.includes(cfg.successTo)) diffs.push(`success output goes to [${ok.join(', ') || 'nothing'}], expected ${cfg.successTo}`);
        if (!err.includes(FAILED_REPLY)) diffs.push(`error output goes to [${err.join(', ') || 'nothing'}], expected ${FAILED_REPLY}`);
        return diffs;
      }),
  },
  {
    name: 'Nothing else is wired into the failure reply from a success output',
    run: () => {
      const diffs: string[] = [];
      for (const cfg of EMAIL_NODES) {
        if (targets(cfg.name, 0).includes(FAILED_REPLY)) diffs.push(`${cfg.name}: success output reaches ${FAILED_REPLY}`);
      }
      return diffs;
    },
  },
  {
    name: 'Complaint-with-order email includes the order number and customer email (Finding A)',
    run: () => {
      const t = String(node('Send Escalation Email (Complaint)').parameters?.text ?? '');
      const diffs: string[] = [];
      if (!/Order:\s*\{\{/.test(t)) diffs.push('no "Order: {{ ... }}" line');
      if (!/Customer email:\s*\{\{/.test(t)) diffs.push('no "Customer email: {{ ... }}" line');
      if (!/Session ID:\s*\{\{/.test(t)) diffs.push('no "Session ID" line');
      return diffs;
    },
  },
  {
    name: 'Plain escalation email includes the question and session ID',
    run: () => {
      const t = String(node('Send Escalation Email').parameters?.text ?? '');
      const diffs: string[] = [];
      if (!/Question:\s*\{\{/.test(t)) diffs.push('no "Question: {{ ... }}" line');
      if (!/Session ID:\s*\{\{/.test(t)) diffs.push('no "Session ID" line');
      return diffs;
    },
  },
  {
    name: 'Failure reply never claims the team was told, and points at Config contactEmail',
    run: () => {
      const c: string = node(FAILED_REPLY).parameters?.jsCode ?? '';
      const diffs: string[] = [];
      if (!c) return [`${FAILED_REPLY} has no jsCode`];
      if (/flagged|notified|passed this along|team member/i.test(c)) diffs.push('claims the team was flagged or notified, which is false when the send failed');
      if (!c.includes("${$('Config').item.json.contactEmail}")) diffs.push('contact address no longer comes from Config');
      if (!/answer:\s*`/.test(c)) diffs.push('answer is not a backtick template literal, so ${...} will print as text');
      return diffs;
    },
  },
  {
    name: 'Success reply (Escalation Stub) points at Config contactEmail via a template literal',
    run: () => {
      const c: string = node('Escalation Stub').parameters?.jsCode ?? '';
      const diffs: string[] = [];
      if (!c.includes("${$('Config').item.json.contactEmail}")) diffs.push('contact address no longer comes from Config');
      if (!/answer:\s*`/.test(c)) diffs.push('answer is not a backtick template literal');
      return diffs;
    },
  },
  {
    name: 'Telegram failure alert cannot block the customer reply (d3261b7)',
    run: () => {
      const diffs: string[] = [];
      const from = targets('Rebuild Failed Answer', 0);
      if (!from.includes('Respond to Webhook')) diffs.push('Rebuild Failed Answer no longer feeds Respond to Webhook directly');
      if (!from.includes('Send a text message')) diffs.push('Rebuild Failed Answer no longer triggers the Telegram alert');
      if (node('Send a text message').onError !== 'continueRegularOutput')
        diffs.push(`Telegram node onError is ${JSON.stringify(node('Send a text message').onError)}, expected continueRegularOutput`);
      return diffs;
    },
  },
  {
    name: 'Config node: keeps the webhook body and defines all six keys',
    run: () => {
      const c = node('Config');
      const diffs: string[] = [];
      if (c.parameters?.includeOtherFields !== true)
        diffs.push('includeOtherFields is not true: the webhook body would be dropped and every downstream $json read breaks');
      const have = new Set((c.parameters?.assignments?.assignments ?? []).map((a: any) => a.name));
      for (const k of ['escalationEmail', 'fromEmail', 'contactEmail', 'contactFacebook', 'businessName', 'timezone'])
        if (!have.has(k)) diffs.push(`Config key "${k}" is missing`);
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
    console.log('The exported workflow no longer has the escalation structure this repo expects.');
    console.log('First rule out a stale export (docs/N8N_NOTES.md): close the n8n tab, reopen, re-download.');
    console.log('If the export is fresh, the live workflow regressed: fix it in n8n and re-export.\n');
    process.exit(1);
  }
}

try {
  main();
} catch (err: any) {
  console.error('Sync test failed to run:', err.message);
  process.exit(1);
}
