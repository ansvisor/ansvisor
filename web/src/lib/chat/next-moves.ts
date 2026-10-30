import { z } from 'zod';
import type { TeamRole } from '@/components/providers/role-provider';
import { maskIds, type ChatNextMove } from './events';

/**
 * Next moves (CHAT-07 §C): what the model suggests with its final answer,
 * and the moves the person is shown. No server code: the engine and the
 * page read these.
 */

/** The engine's own tool for next moves: never a registry row, never shown. */
export const NEXT_MOVES_TOOL = 'suggest_next_moves';

/** A run shows at most this many (CHAT-07, agentic UI update: "up to 3 next-move cards"). */
export const MAX_NEXT_MOVES = 3;

/** One move per kind at most (§C item 6). */
export const NEXT_MOVE_KINDS = ['continue', 'deepen', 'act', 'repeat', 'reuse'] as const;

/** Roles that only read: a write or an EXECUTE move is never theirs, as a card or as ghost text (§C item 4). */
const READ_ONLY_ROLES: readonly TeamRole[] = ['analyst', 'agency_partner'];

/** What the model suggests with: its ranked moves, best first. */
export const nextMovesInput = z.object({
  moves: z
    .array(
      z.object({
        label: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .describe('Names a real object: "Do the same for /features". Never an id or a tool.'),
        prompt: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .describe('The message it sends, as the person would type it, under 80 characters.'),
        kind: z.enum(NEXT_MOVE_KINDS),
        class: z
          .enum(['read', 'write', 'execute'])
          .describe('read: only reads data; write: changes the workspace; execute: goes live.'),
        continues_this_run: z
          .boolean()
          .optional()
          .describe('It continues an object of this answer (a page, task or prompt it worked on).'),
      }),
    )
    .min(1)
    .max(4),
});
export type NextMoveInput = z.output<typeof nextMovesInput>['moves'][number];

/** A move as chat_next_moves keeps it, in rank order. */
export interface PickedMove {
  label: string;
  prompt: string;
  class: NextMoveInput['class'];
  /** The server's mark that it continues this run's object: only then ghost text. */
  ghostOk: boolean;
}

/**
 * The moves the person is shown, best first: read moves only for an
 * Analyst or an Agency partner, and while the workspace is read-only; one
 * per kind and per prompt; at most three; ids masked.
 */
export function pickNextMoves(
  moves: readonly NextMoveInput[],
  who: { role: TeamRole; writable: boolean },
): PickedMove[] {
  const readOnly = READ_ONLY_ROLES.includes(who.role) || !who.writable;
  const kinds = new Set<string>();
  const prompts = new Set<string>();
  const picked: PickedMove[] = [];
  for (const move of moves) {
    if (readOnly && move.class !== 'read') continue;
    const prompt = maskIds(move.prompt).trim();
    const key = prompt.toLowerCase();
    if (!prompt || kinds.has(move.kind) || prompts.has(key)) continue;
    kinds.add(move.kind);
    prompts.add(key);
    picked.push({
      label: maskIds(move.label).trim() || prompt,
      prompt,
      class: move.class,
      ghostOk: move.continues_this_run === true,
    });
    if (picked.length === MAX_NEXT_MOVES) break;
  }
  return picked;
}

/** A kept move as the browser gets it: the ghost mark, never its class. */
export function clientMove(move: Pick<PickedMove, 'label' | 'prompt' | 'ghostOk'>): ChatNextMove {
  return { label: move.label, prompt: move.prompt, ...(move.ghostOk ? { ghost: true } : {}) };
}

/**
 * The composer's ghost text after an answer (§C item 4): the first move's
 * prompt when it continues this run; else none. The moves are already the
 * role's, so a read-only role's ghost is its best read move, or none.
 */
export function ghostOf(moves: readonly ChatNextMove[]): string | undefined {
  const first = moves[0];
  return first?.ghost ? first.prompt : undefined;
}
