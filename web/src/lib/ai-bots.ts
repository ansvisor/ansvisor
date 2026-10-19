/**
 * The AI bots source card's state (AT-010), kept apart from the card so it is
 * tested on its own.
 */

import type { BotConnection, BotConnections, BotUsage } from '@/lib/actions/ai-bots';

/**
 * locked — the plan has no bot report (Starter: Upgrade);
 * off — nothing connected yet;
 * waiting — connected, no request has arrived yet;
 * on — requests arrive.
 */
export type BotsCardState = 'locked' | 'off' | 'waiting' | 'on';

/** The newest request any connection sent, or null. */
export function lastBotEvent(connections: BotConnection[]): string | null {
  return connections.reduce<string | null>(
    (latest, c) => (c.lastEventAt && (!latest || c.lastEventAt > latest) ? c.lastEventAt : latest),
    null,
  );
}

export function botsCardState({ connections, usage }: BotConnections): BotsCardState {
  if (usage.cap === 0) return 'locked';
  if (connections.length === 0) return 'off';
  return lastBotEvent(connections) ? 'on' : 'waiting';
}

/**
 * The day detailed rows start again when this month's cap was reached
 * ("Detailed rows paused until Nov 1, totals still counted", spec §6.3);
 * null while under the cap.
 */
export function rowsPausedUntil(usage: BotUsage): string | null {
  if (!usage.cappedAt || usage.cap <= 0 || !/^\d{4}-\d{2}-01$/.test(usage.month)) return null;
  const [y, m] = usage.month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}
