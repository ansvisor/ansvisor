/** Where a job's results go (CHAT-12 item 7): the card's and the job page's Deliver to. Pure. */
export const DELIVER_CHOICES = ['chat', 'email', 'both'] as const;
export type DeliverChoice = (typeof DELIVER_CHOICES)[number];

/** A choice as chat_schedules.deliver_to keeps it. */
export const deliverToOf = (choice: DeliverChoice): ('chat' | 'email')[] =>
  choice === 'both' ? ['chat', 'email'] : [choice];

/** chat_schedules.deliver_to as a choice. */
export const deliverChoiceOf = (deliverTo: readonly string[]): DeliverChoice =>
  deliverTo.includes('chat') && deliverTo.includes('email')
    ? 'both'
    : deliverTo.includes('email')
      ? 'email'
      : 'chat';
