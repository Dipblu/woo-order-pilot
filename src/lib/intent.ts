// Canonical intent classification logic for Order Pilot.
//
// n8n is the source of truth for behaviour. This file mirrors the logic
// in the "Classify Intent" Code node so it can be tested;
// `npm run test:intent-sync` fails if the two have drifted.
//
// Keep this file free of n8n globals ($, $json, item). The n8n-only
// plumbing lives in the n8n node.

export const ORDER_KEYWORDS = [
  'order status',
  'my order',
  'track my',
  'where is my',
  'delivery status',
  'has my order',
  'status of my order',
];

export const COMPLAINT_KEYWORDS = [
  'refund',
  'complaint',
  'terrible',
  'awful',
  'worst',
  'unacceptable',
  'never arrived',
  'missing item',
  'wrong item',
  'not happy',
  'unhappy',
  'disappointed',
  'compensation',
  'manager',
  'escalate',
  'cold food',
  'arrived cold',
  'very late',
  'rude',
  'poor service',
  'bad experience',
  'ridiculous',
  'angry',
  'upset',
  'frustrated',
  'damaged',
  'broken',
  'spoiled',
  'horrible',
  'did not arrive',
  "didn't arrive",
  "hasn't arrived",
  'has not arrived',
  'have not received',
  "haven't received",
  'still waiting',
  'not on time',
  'late delivery',
  'took too long',
  'still not here',
  'wrong order',
  'wrong food',
  'not what i ordered',
  'incorrect order',
];

export type Intent = 'faq' | 'order_status' | 'complaint' | 'complaint_with_order';

/** Shape of the row returned by the "Load Pending Intent" Postgres node. */
export type PendingState = {
  pending_intent?: string | null;
  pending_order_number?: string | null;
  pending_email?: string | null;
  pending_question?: string | null;
};

export type Classification = {
  question: string;
  intent: Intent | string;
  orderNumber: string | null;
  email: string | null;
  isContinuation: boolean;
};

export function classifyIntent(
  rawMessage: string | null | undefined,
  pending: PendingState = {}
): Classification {
  const message = (rawMessage || '').trim();
  const lower = message.toLowerCase();

  const emailMatch = message.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  const orderNumMatch =
    lower.match(/order\s*#?\s*(\d{2,8})/) ||
    message.match(/#(\d{2,8})\b/) ||
    (emailMatch ? message.match(/\b(\d{2,8})\b/) : null);

  const pendingIntent = pending.pending_intent || null;
  const suppliedDetails = Boolean(emailMatch || orderNumMatch);
  const isContinuation = Boolean(pendingIntent && suppliedDetails);

  const orderNumber =
    (orderNumMatch ? orderNumMatch[1] : null) ||
    (isContinuation ? pending.pending_order_number : null) ||
    null;
  const email =
    (emailMatch ? emailMatch[0].toLowerCase() : null) ||
    (isContinuation ? pending.pending_email : null) ||
    null;

  const isCancelQuestion = lower.includes('cancel');
  const looksLikeOrderQuery =
    Boolean(email && orderNumber) ||
    (!isCancelQuestion && ORDER_KEYWORDS.some((k) => lower.includes(k)));
  const looksLikeComplaint = COMPLAINT_KEYWORDS.some((k) => lower.includes(k));

  let intent: Intent | string = 'faq';
  if (isContinuation) intent = pendingIntent as string;
  else if (looksLikeComplaint && email && orderNumber) intent = 'complaint_with_order';
  else if (looksLikeComplaint) intent = 'complaint';
  else if (looksLikeOrderQuery) intent = 'order_status';

  return {
    question: isContinuation && pending.pending_question ? pending.pending_question : message,
    intent,
    orderNumber,
    email,
    isContinuation,
  };
}
