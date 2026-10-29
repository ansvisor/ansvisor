import type { Json } from '@/types/supabase';
import { logActivity, type ActivityApproval, type ActivityPlace } from './activity';
import { idempotencyKey, requestHash, sweepExpiredKeys, withIdempotencyKey } from './idempotency';
import type { ChatMode, ChatSurface } from './precedence';
import type { ChatTool, ChatToolContext } from './registry/define-tool';
import { undoRule, type WriteRecord } from './undo';

/**
 * Runs a WRITE or an EXECUTE the precedence allowed (decideToolCall, then
 * the card's OK or the click when it asked for one), once per approval, and
 * logs it: the change runs under its idempotency key (idempotency.ts), the
 * state Undo needs is read around it (undo.ts), and the Activity log gets
 * its row (activity.ts) with the mode, the approval and the Undo window.
 * A repeat of the approval (a double click, a reconnect, a retry) returns
 * the first call's result and log row and changes nothing. Server only: the
 * engine (C3) calls it for each change a run makes.
 */

export interface WriteRequest {
  /** A WRITE or EXECUTE row of the registry. */
  tool: ChatTool;
  /** Its input, already parsed by the row's schema. */
  input: unknown;
  /** Who the tool acts as: the signed-in person. */
  ctx: ChatToolContext;
  organizationId: string;
  userId: string;
  /** The call's brand, as the precedence found it (readToolCall, resolveCallBrand). */
  brandId: string | null;
  surface: ChatSurface;
  mode: ChatMode;
  /** How it was approved: approvalFor(decision) once the card or the click came. */
  approval: Exclude<ActivityApproval, { kind: 'run' }>;
  place: ActivityPlace;
  /**
   * The approval it runs on: the run step that asked for it (the card the
   * person clicks, or the step that ran it without one). Its repeats share it.
   */
  approvalKey: string;
}

export type WriteOutcome =
  /** repeated: an earlier call with the approval made the change; this is its result. */
  | { code: 'ok'; output: Json; activityId: string | null; repeated: boolean }
  /** The approval was used for another change (§11a): show the card again. */
  | { code: 'approval_mismatch' }
  /** The first call with the approval is still running. */
  | { code: 'in_progress' }
  /**
   * The change failed, or its key couldn't be read: nothing was made and the
   * approval may be tried again (§11b). reason: for the server's log and the
   * step's debug record, never the person.
   */
  | { code: 'failed'; reason: string };

const toJson = (value: unknown): Json =>
  value === undefined ? null : (JSON.parse(JSON.stringify(value)) as Json);

/**
 * Never throws for a failure on the way (the engine and server actions call
 * it): `failed`. Only a call against the rules (a read, an EXECUTE without
 * its click) throws, before anything runs.
 */
export async function runLoggedWrite(req: WriteRequest): Promise<WriteOutcome> {
  const { tool } = req;
  if (tool.class === 'read') throw new Error('A read changes nothing to log');
  if (tool.class === 'execute' && req.approval.kind !== 'click') {
    throw new Error("An EXECUTE runs on the person's click only");
  }
  try {
    return await run(req);
  } catch (err) {
    console.error('Chat could not make a change:', err);
    return { code: 'failed', reason: err instanceof Error ? err.message : String(err) };
  }
}

async function run(req: WriteRequest): Promise<WriteOutcome> {
  const { tool } = req;
  const rule = undoRule(tool);

  const outcome = await withIdempotencyKey<Json>(
    {
      organizationId: req.organizationId,
      key: idempotencyKey(tool.labelKey, [req.approvalKey]),
      requestHash: requestHash(tool.labelKey, req.input),
    },
    async () => {
      const before = rule ? await rule.before(req.input) : null;
      const output = await tool.run(req.ctx, req.input as never);
      // The change is made: whatever happens to its log row, it isn't made again.
      let activityId: string | null = null;
      try {
        activityId = await logActivity(await activityOf(req, rule, before, output));
      } catch (err) {
        console.error('Chat could not log a change it made:', err);
      }
      return { result: toJson(output), activityId };
    },
  );

  if (outcome.kind === 'mismatch') return { code: 'approval_mismatch' };
  if (outcome.kind === 'busy') return { code: 'in_progress' };
  if (outcome.kind === 'ran') await sweepExpiredKeys(req.organizationId);
  return {
    code: 'ok',
    output: outcome.result,
    activityId: outcome.activityId,
    repeated: outcome.kind === 'repeat',
  };
}

/** The log row for a change: the rule's record, or the bare facts when it has none or fails. */
async function activityOf(
  req: WriteRequest,
  rule: ReturnType<typeof undoRule>,
  before: Awaited<ReturnType<NonNullable<ReturnType<typeof undoRule>>['before']>>,
  output: unknown,
) {
  let record: WriteRecord = {
    target: { type: rule?.targetType ?? req.tool.area, id: null },
    summaryParams: {},
    undo: null,
  };
  if (rule) {
    try {
      record = await rule.record(req.input, output, before);
    } catch (err) {
      // Logged without an Undo rather than not at all.
      console.error('Chat could not read what Undo needs:', err);
    }
  }
  return {
    organizationId: req.organizationId,
    userId: req.userId,
    brandId: req.brandId,
    place: req.place,
    surface: req.surface,
    tool: req.tool,
    mode: req.mode,
    approval: req.approval,
    target: record.target,
    summary: { key: req.tool.labelKey, params: record.summaryParams },
    undo:
      rule && record.undo
        ? { data: record.undo, until: new Date(Date.now() + rule.windowMs) }
        : null,
  };
}
