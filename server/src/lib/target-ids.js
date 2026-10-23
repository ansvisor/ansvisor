/**
 * The most target keys a signal or an action lists beyond the targets it
 * names (AC-009). A group signal names 50 targets with their labels and
 * lists every one's id up to this, so the action it starts counts and keeps
 * the whole group (action_entities, 00244); bigger groups count up to here.
 */
export const MAX_TARGET_IDS = 1000;
