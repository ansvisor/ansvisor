import { ACCOUNT_READS } from './account';
import { ACTION_CENTER_READS } from './action-center';
import { AI_TRAFFIC_READS } from './ai-traffic';
import { PROMPTS_READS } from './prompts';
import { VISIBILITY_READS } from './visibility';

/** Chat Wave 1 W1-16's reads, one file per area; tools.ts lists them with the rest. */
export const AREA_READS = [
  ...VISIBILITY_READS,
  ...PROMPTS_READS,
  ...ACTION_CENTER_READS,
  ...AI_TRAFFIC_READS,
  ...ACCOUNT_READS,
];
