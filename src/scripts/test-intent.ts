import { classifyIntent, type PendingState } from '../lib/intent.js';

// Regression suite for intent classification.
//
// These cases document what the classifier ACTUALLY does today, quirks
// included. A failure here means the logic changed, not that the logic is
// wrong. Known-questionable behaviours are tagged QUIRK so nobody "fixes"
// one by accident.

type Expect = {
  intent?: string;
  orderNumber?: string | null;
  email?: string | null;
  isContinuation?: boolean;
  question?: string;
};

type TestCase = {
  name: string;
  message: string;
  pending?: PendingState;
  expect: Expect;
};

const NO_PENDING: PendingState = {};

const TEST_CASES: TestCase[] = [
  // --- plain FAQ ---
  { name: 'menu question', message: "What's on the menu?", expect: { intent: 'faq' } },
  { name: 'delivery fee', message: 'How much is the delivery fee?', expect: { intent: 'faq' } },
  { name: 'empty message', message: '', expect: { intent: 'faq', orderNumber: null, email: null } },
  { name: 'whitespace only', message: '   ', expect: { intent: 'faq', question: '' } },

  // --- order status via keywords ---
  { name: 'where is my order', message: 'where is my order?', expect: { intent: 'order_status' } },
  { name: 'track my order', message: 'can you track my delivery', expect: { intent: 'order_status' } },
  { name: 'order status phrase', message: 'order status please', expect: { intent: 'order_status' } },

  // --- the cancel collision (handoff: prime test case for item 9) ---
  {
    name: 'QUIRK cancel question stays faq despite my order keyword',
    message: 'how can I cancel my order?',
    expect: { intent: 'faq' },
  },
  {
    name: 'QUIRK any cancel mention suppresses the keyword branch',
    message: 'my order was cancelled without warning',
    expect: { intent: 'faq' },
  },

  // --- order number extraction ---
  { name: 'order N form', message: 'where is order 771', expect: { orderNumber: '771' } },
  { name: 'order #N form', message: 'where is order #771', expect: { orderNumber: '771' } },
  { name: 'hash N form', message: 'any news on #771', expect: { orderNumber: '771' } },
  {
    name: 'bare digits ignored without an email',
    message: 'where is 771',
    expect: { orderNumber: null },
  },
  {
    name: 'bare digits extracted when an email is present',
    message: '771 hermosodennis2@gmail.com',
    expect: { orderNumber: '771', email: 'hermosodennis2@gmail.com' },
  },
  { name: 'single digit too short', message: 'order 7', expect: { orderNumber: null } },

  // --- email extraction ---
  {
    name: 'email lowercased',
    message: 'my email is Hermoso.Dennis+test@Gmail.com',
    expect: { email: 'hermoso.dennis+test@gmail.com' },
  },

  // --- email + order number implies order lookup ---
  {
    name: 'email and order number route to order_status',
    message: 'order 771 and hermosodennis2@gmail.com',
    expect: { intent: 'order_status', orderNumber: '771', email: 'hermosodennis2@gmail.com' },
  },

  // --- complaints ---
  { name: 'cold food complaint', message: 'my food arrived cold and I am very upset', expect: { intent: 'complaint' } },
  { name: 'refund request', message: 'I want a refund', expect: { intent: 'complaint' } },
  { name: 'apostrophe variant', message: "my order didn't arrive", expect: { intent: 'complaint' } },
  { name: 'never arrived', message: 'my food never arrived', expect: { intent: 'complaint' } },

  // --- complaint_with_order needs BOTH email and order number ---
  {
    name: 'complaint with both details',
    message: 'order 771 hermosodennis2@gmail.com my food was cold food and late',
    expect: { intent: 'complaint_with_order', orderNumber: '771', email: 'hermosodennis2@gmail.com' },
  },
  {
    name: 'complaint with order number only stays complaint',
    message: 'order 771 arrived cold',
    expect: { intent: 'complaint', orderNumber: '771', email: null },
  },
  {
    name: 'complaint with email only stays complaint',
    message: 'hermosodennis2@gmail.com my food arrived cold',
    expect: { intent: 'complaint', orderNumber: null },
  },

  // --- continuation / session state ---
  {
    name: 'continuation merges stored order number',
    message: 'hermosodennis2@gmail.com',
    pending: { pending_intent: 'order_status', pending_order_number: '771', pending_question: 'Where is my order?' },
    expect: {
      intent: 'order_status',
      isContinuation: true,
      orderNumber: '771',
      email: 'hermosodennis2@gmail.com',
      question: 'Where is my order?',
    },
  },
  {
    name: 'continuation merges stored email',
    message: 'order 771',
    pending: { pending_intent: 'order_status', pending_email: 'hermosodennis2@gmail.com' },
    expect: { intent: 'order_status', isContinuation: true, orderNumber: '771', email: 'hermosodennis2@gmail.com' },
  },
  {
    name: 'no continuation when the reply supplies no details',
    message: 'actually what are your hours?',
    pending: { pending_intent: 'order_status', pending_order_number: '771' },
    expect: { intent: 'faq', isContinuation: false, orderNumber: null },
  },
  {
    name: 'no continuation when nothing is pending',
    message: 'order 771 hermosodennis2@gmail.com',
    pending: NO_PENDING,
    expect: { isContinuation: false, intent: 'order_status' },
  },
  {
    name: 'QUIRK continuation outranks a fresh complaint',
    message: 'order 771 hermosodennis2@gmail.com and the food was terrible',
    pending: { pending_intent: 'order_status' },
    expect: { intent: 'order_status', isContinuation: true },
  },
  {
    name: 'stored question replaces the message on continuation',
    message: 'order 771',
    pending: { pending_intent: 'order_status', pending_question: 'How long will delivery take?' },
    expect: { question: 'How long will delivery take?' },
  },
  {
    name: 'message kept when pending has no stored question',
    message: 'order 771',
    pending: { pending_intent: 'order_status' },
    expect: { question: 'order 771' },
  },
  // --- item 10: partial replies across turns ---
  {
    name: 'partial reply turn 1 — order number only, nothing stored yet',
    message: 'order 771',
    pending: { pending_intent: 'order_status' },
    expect: { intent: 'order_status', isContinuation: true, orderNumber: '771', email: null },
  },
  {
    name: 'partial reply turn 2 — email arrives, order number from pending',
    message: 'hermosodennis2@gmail.com',
    pending: { pending_intent: 'order_status', pending_order_number: '771' },
    expect: { intent: 'order_status', isContinuation: true, orderNumber: '771', email: 'hermosodennis2@gmail.com' },
  },
  {
    name: 'partial reply reversed — email first',
    message: 'hermosodennis2@gmail.com',
    pending: { pending_intent: 'order_status' },
    expect: { intent: 'order_status', isContinuation: true, orderNumber: null, email: 'hermosodennis2@gmail.com' },
  },
  {
    name: 'partial reply reversed — order number second, email from pending',
    message: 'order 771',
    pending: { pending_intent: 'order_status', pending_email: 'hermosodennis2@gmail.com' },
    expect: { intent: 'order_status', isContinuation: true, orderNumber: '771', email: 'hermosodennis2@gmail.com' },
  },

  // --- item 10: follow-ups that must NOT continue ---
  {
    name: 'unrelated follow-up containing digits does not continue',
    message: 'do you deliver to 1771?',
    pending: { pending_intent: 'order_status' },
    expect: { intent: 'faq', isContinuation: false, orderNumber: null },
  },
  {
    name: 'BUG quantity after "order" is read as an order number mid-conversation',
    message: 'can I order 20 pieces of lumpia?',
    pending: { pending_intent: 'order_status' },
    expect: { intent: 'order_status', isContinuation: true, orderNumber: '20' },
  },
  {
    name: 'single-digit quantity is below the 2-digit floor so it is safe',
    message: 'can I order 3 lumpia?',
    pending: { pending_intent: 'order_status' },
    expect: { intent: 'faq', isContinuation: false, orderNumber: null },
  },
  {
    name: 'quantity phrasing is harmless with no pending intent',
    message: 'can I order 20 pieces of lumpia?',
    expect: { intent: 'faq', isContinuation: false },
  },

  // --- item 10: pending intent variants ---
  {
    name: 'continuation adopts a pending complaint intent',
    message: 'order 771 hermosodennis2@gmail.com',
    pending: { pending_intent: 'complaint' },
    expect: { intent: 'complaint', isContinuation: true },
  },
  {
    name: 'continuation adopts a pending complaint_with_order intent',
    message: 'order 771 hermosodennis2@gmail.com',
    pending: { pending_intent: 'complaint_with_order' },
    expect: { intent: 'complaint_with_order', isContinuation: true },
  },
  {
    name: 'empty-string pending_intent is treated as none',
    message: 'order 771',
    pending: { pending_intent: '' },
    expect: { intent: 'faq', isContinuation: false, orderNumber: '771' },
  },
  {
    name: 'GAP stale pending intent is indistinguishable from a fresh one',
    message: 'order 771',
    pending: { pending_intent: 'order_status', pending_question: 'asked three days ago' },
    expect: { intent: 'order_status', isContinuation: true, question: 'asked three days ago' },
  },

  // --- extraction edge cases ---
  {
    name: 'first email wins when two are present',
    message: 'a@b.com or c@d.com',
    expect: { email: 'a@b.com' },
  },
  {
    name: 'order number with hash plus email',
    message: '#771 hermosodennis2@gmail.com',
    expect: { orderNumber: '771', email: 'hermosodennis2@gmail.com', intent: 'order_status' },
  },
  {
    name: 'eight-digit order number still extracted',
    message: 'order 12345678',
    expect: { orderNumber: '12345678' },
  },
  {
    name: 'nine-digit number truncated to the first eight',
    message: 'order 123456789',
    expect: { orderNumber: '12345678' },
  },
];

function check(actual: Record<string, unknown>, expected: Expect): string[] {
  const diffs: string[] = [];
  for (const [key, want] of Object.entries(expected)) {
    const got = actual[key];
    if (got !== want) {
      diffs.push(`${key}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
    }
  }
  return diffs;
}

function main() {
  let passed = 0;
  const failures: { tc: TestCase; diffs: string[] }[] = [];

  for (const tc of TEST_CASES) {
    const actual = classifyIntent(tc.message, tc.pending ?? NO_PENDING);
    const diffs = check(actual as unknown as Record<string, unknown>, tc.expect);
    if (diffs.length === 0) {
      passed++;
    } else {
      failures.push({ tc, diffs });
    }
  }

  console.log(`\n${passed}/${TEST_CASES.length} passed\n`);

  if (failures.length > 0) {
    console.log('FAILURES:\n');
    for (const { tc, diffs } of failures) {
      console.log(`${tc.name}`);
      console.log(`  Message: "${tc.message}"`);
      for (const d of diffs) console.log(`  ${d}`);
      console.log('---');
    }
    process.exit(1);
  }
}

try {
  main();
} catch (err: any) {
  console.error('Intent test failed to run:', err.message);
  process.exit(1);
}