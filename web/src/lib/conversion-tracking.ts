/**
 * What a brand installs to see conversions from AI visits (CE-017): the
 * tracking snippet's tag, with conversions on (data-c, data-consent), the
 * lines the site adds, and the Shopify Customer events pixel. Built here, as
 * the snippet's tag always was, from the public API URL and the brand's
 * tracking code; the snippet itself is the server's (tracking-script.js).
 */

export type ConversionsConsent = 'wait' | 'always';

export const CONSENT_MODES: readonly ConversionsConsent[] = ['wait', 'always'];

export function isConversionsConsent(value: unknown): value is ConversionsConsent {
  return value === 'wait' || value === 'always';
}

/**
 * The snippet's tag for a brand, or null without an API URL or a tracking
 * code. With conversions (the brand's consent mode), it follows AI visitors
 * to conversions; without, it is the tag as it always was.
 */
export function trackingSnippetTag(
  apiUrl: string | null | undefined,
  trackingCode: string | null | undefined,
  conversions: ConversionsConsent | null = null,
): string | null {
  if (!apiUrl || !trackingCode) return null;
  const extra = conversions ? ` data-c="1" data-consent="${conversions}"` : '';
  return `<script src="${apiUrl}/t.js" data-t="${trackingCode}"${extra} defer></script>`;
}

/** What the site calls once the visitor agrees (its cookie banner), on every page. */
export const CONSENT_CALL = "ansvisor('consent', 'granted');";

/** The site's own conversion, and an order with its value and units. */
export const CONVERSION_CALL = "ansvisor('conversion', { type: 'demo' });";
export const ORDER_CALL =
  "ansvisor('conversion', { type: 'order', value: 129.5, currency: 'EUR', units: 2, order: '1001' });";

/** For calls made before the tag loads (GTM, a banner that runs first): goes above both. */
export const QUEUE_STUB =
  '<script>window.ansvisor=window.ansvisor||function(){(ansvisor.q=ansvisor.q||[]).push(arguments)};</script>';

/** What a form adds to say its goal, or to stay out. */
export const FORM_GOAL_ATTRIBUTE = 'data-ansvisor-goal="demo"';
export const FORM_OFF_ATTRIBUTE = 'data-ansvisor="off"';

/**
 * The Shopify Customer events custom pixel (Web Pixels API): Shopify runs no
 * theme code on checkout, so the order is sent from here, with its value,
 * currency and units, by the visitor id the snippet kept on the storefront
 * (the checkout is on the shop's domain). A visitor the snippet didn't
 * follow (no AI visit, no consent) sends nothing; the server credits the
 * rest as the snippet's events, and counts an order sent twice once. The
 * checkout's address goes as /checkout: its path carries the order's token.
 * Null without an API URL or a tracking code.
 */
export function shopifyPixelCode(
  apiUrl: string | null | undefined,
  trackingCode: string | null | undefined,
): string | null {
  if (!apiUrl || !trackingCode) return null;
  return `// Ansvisor: orders from AI visits
const ANSVISOR_TRACK = ${JSON.stringify(`${apiUrl}/track/${trackingCode}`)};
analytics.subscribe("checkout_completed", async (event) => {
  let visitor = null;
  try {
    visitor = JSON.parse((await browser.localStorage.getItem("ansvisor_v")) || "null");
  } catch (e) {}
  if (!visitor || !visitor.id || !visitor.f) return;
  const checkout = event.data.checkout || {};
  const total = checkout.totalPrice || {};
  const units = (checkout.lineItems || []).reduce((sum, item) => sum + (item.quantity || 0), 0);
  const order = {
    k: "cv",
    g: "order",
    o: "shopify",
    id: visitor.id,
    f: visitor.f,
    u: event.context.document.location.origin + "/checkout",
    q: units,
  };
  const value = Number(total.amount);
  if (Number.isFinite(value) && value >= 0) order.val = value;
  if (typeof total.currencyCode === "string") order.cur = total.currencyCode;
  const ref = (checkout.order && checkout.order.id) || checkout.token;
  if (ref) order.ref = String(ref);
  fetch(ANSVISOR_TRACK, {
    method: "POST",
    body: JSON.stringify(order),
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    keepalive: true,
  }).catch(() => {});
});
`;
}
