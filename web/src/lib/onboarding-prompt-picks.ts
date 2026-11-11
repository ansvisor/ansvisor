/** How many of the suggested prompts the onboarding prompts step ticks at first. */
export const DEFAULT_PICKED_PROMPTS = 15;

export interface PromptPick {
  text: string;
  picked: boolean;
}

export interface TopicPromptPicks {
  topic: string;
  prompts: PromptPick[];
}

/**
 * The prompts step's checklist from the generated groups: `count` prompts
 * ticked, a topic at a time (each topic's first prompt, then each one's
 * second, and so on), so every topic starts with some and the person
 * unticks the rest of what they don't want.
 */
export function withDefaultPicks(
  groups: { topic: string; prompts: string[] }[],
  count: number = DEFAULT_PICKED_PROMPTS,
): TopicPromptPicks[] {
  const ticked = groups.map(() => 0);
  let left = count;
  for (let rank = 0; left > 0; rank++) {
    let more = false;
    groups.forEach((group, i) => {
      if (left > 0 && rank < group.prompts.length) {
        ticked[i]++;
        left--;
        more = true;
      }
    });
    if (!more) break;
  }
  return groups.map((group, i) => ({
    topic: group.topic,
    prompts: group.prompts.map((text, rank) => ({ text, picked: rank < ticked[i] })),
  }));
}

/**
 * Prompts the brand may still track on the organization's plan: its cap less
 * what the organization's other brands use. Null when unknown (not read yet,
 * or the read failed) or unlimited (-1).
 */
export function promptRoom(
  capacity: { maxPrompts: number; used: number } | null | undefined,
): number | null {
  if (!capacity || capacity.maxPrompts === -1) return null;
  return Math.max(0, capacity.maxPrompts - capacity.used);
}

/**
 * How many prompts the step ticks at first: 15, or the plan's room when it
 * has less, so nothing starts out waiting for a spot.
 */
export function defaultPickCount(room: number | null): number {
  return room === null ? DEFAULT_PICKED_PROMPTS : Math.min(DEFAULT_PICKED_PROMPTS, room);
}

/** The ticked prompts: the ones the step saves, and counts toward the plan. */
export function pickedCount(groups: TopicPromptPicks[]): number {
  return groups.reduce((sum, group) => sum + group.prompts.filter((p) => p.picked).length, 0);
}
