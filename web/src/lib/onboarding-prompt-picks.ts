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

/** The ticked prompts: the ones the step saves, and counts toward the plan. */
export function pickedCount(groups: TopicPromptPicks[]): number {
  return groups.reduce((sum, group) => sum + group.prompts.filter((p) => p.picked).length, 0);
}
