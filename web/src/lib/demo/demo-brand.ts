/**
 * The demo brand (00380): a brand in the workspace's own organization whose
 * prompts, answers, content and reports are sample data, written by the
 * server's generator into the real tables. Every page shows it as it shows
 * any brand; anything that would run, write or spend opens the plan dialog
 * instead, with the demo's offer.
 */

/**
 * What the plan dialog offers from the demo brand: a workspace that never
 * had a subscription chooses between the free trial and buying now (the
 * first-month offer); one whose trial or plan ended buys now.
 */
export type DemoOffer = 'trial' | 'first_month';

/** The offer, from whether the organization ever had a Stripe subscription. */
export function demoOffer(everSubscribed: boolean): DemoOffer {
  return everSubscribed ? 'first_month' : 'trial';
}

/**
 * What was clicked, from the read-only label a guarded button gives
 * ("Adding prompts needs a plan", readOnly.actions): its doing alone
 * ("Adding prompts"), which the demo's label follows with "works on your own
 * brand". A label written another way is kept whole.
 */
export function demoActionName(label: string): string {
  return label.replace(/\s+needs a plan\.?$/, '');
}
