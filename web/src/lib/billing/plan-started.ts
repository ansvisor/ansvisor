/**
 * Sent on `window` once a trial's plan started outside Billing's plan cards
 * (Start my plan now, components/ai-usage/start-plan-now.tsx), with the
 * subscription as PATCH /api/stripe/subscription answers: Billing reads its
 * plan card and AI usage card again.
 */
export const PLAN_STARTED_EVENT = 'ansvisor:plan-started';
