/**
 * The mark Stripe Checkout's cancel URL carries back (api/stripe/checkout),
 * so the page says nothing was charged (CheckoutCanceledNote). A plain
 * module: the route reads it on the server, the note in the browser.
 */
export const CHECKOUT_CANCELED_PARAM = 'checkout';
export const CHECKOUT_CANCELED_VALUE = 'canceled';
