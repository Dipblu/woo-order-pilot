// Canonical intent classification logic for Order Pilot.
//
// This is the SOURCE OF TRUTH. The n8n "Classify Intent" Code node is
// generated from it by `npm run gen:intent`, and `npm run test:intent`
// fails if the two have drifted.
//
// Keep this file free of n8n globals ($, $json, item). The n8n-only
// plumbing lives in the generator's wrapper, not here.

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
  'was cancelled',
  'was canceled',
  'cancelled without',
  'canceled without',
  'you cancelled',
  'you canceled',
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

  // "order 771" is an order number. "can I order 20 pieces" is a quantity.
  // Both match /order\s*(\d{2,8})/, so the bare form is rejected when
  // "order" reads as a verb or the digits are followed by a unit. An
  // explicit "order #20" is always trusted.
  const orderWordMatch = lower.match(/order\s*#?\s*(\d{2,8})/);
  let orderPhraseMatch: RegExpMatchArray | null = null;
  if (orderWordMatch) {
    const at = orderWordMatch.index ?? 0;
    const before = lower.slice(0, at);
    const after = lower.slice(at + orderWordMatch[0].length);
    const explicitHash = /order\s*#\s*\d/.test(orderWordMatch[0]);
    const orderIsVerb = /(?:can|could|may|should|want to|wanna|would like to|like to|to|please)\s+(?:i|we|you)?\s*$/.test(
      before
    );
    const unitFollows =
      /^\s*(?:of\b|pcs?\b|pieces?\b|orders?\b|servings?\b|pax\b|plates?\b|bowls?\b|packs?\b|boxes\b|sets?\b|kilos?\b|kgs?\b|grams?\b)/.test(
        after
      );
    if (explicitHash || (!orderIsVerb && !unitFollows)) orderPhraseMatch = orderWordMatch;
  }

  const orderNumMatch =
    orderPhraseMatch ||
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

  // "how can I cancel my order?" is a request and must not hit the
  // order-lookup keyword branch. "my order was cancelled" is a report about
  // something that already happened, and should route normally.
  const isCancelQuestion = lower.includes('cancel') && !/\bcancell?ed\b/.test(lower);
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
