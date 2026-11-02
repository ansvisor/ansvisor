/**
 * Agents that publish and send on their own (AUTONOMOUS-GO-LIVE): what the
 * browser and the server share. Pure.
 */

/** The version of the responsibility text an Admin accepts (chatAccess.settings.goLive.dialog). */
export const GO_LIVE_TERMS = 1;

/** The go-live groups an Admin may allow on their own; v1 has publishing alone. */
export const GO_LIVE_GROUPS = ['publishing'] as const;
