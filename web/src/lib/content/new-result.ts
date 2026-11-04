import type { GenerationJobStatus } from '@/lib/actions/content';

type JobResult = NonNullable<GenerationJobStatus['result']>;

/** A `content` message key and its values. */
export interface NewResultLine {
  key: string;
  values?: Record<string, string | number>;
}

export interface NewResultMessage {
  tone: 'success' | 'info' | 'error';
  title: NewResultLine;
  /** Why fewer came back than were asked for, one sentence each. */
  reasons: NewResultLine[];
  /** The open opportunity that already answers the asked-for prompt. */
  existingId?: string;
}

/**
 * What the "+ New" toast says when its run ends (CONTENT-003): how many were
 * created, which were another angle on a need that already had one, and,
 * when that's fewer than asked for, why: needs added to existing
 * opportunities, needs with no tracked answers to write from yet, and needs
 * that already have an opportunity. A result without `scope` (a server from
 * before it) keeps the old wording.
 */
export function newResultMessage(result: JobResult): NewResultMessage {
  if (result.limited) return { tone: 'error', title: { key: 'newLimitReached' }, reasons: [] };
  const generated = result.generated ?? 0;
  const duplicates = result.duplicates ?? 0;
  if (generated === 0 && result.existingId) {
    return {
      tone: 'info',
      title: { key: 'newExisting' },
      reasons: [],
      existingId: result.existingId,
    };
  }
  // Written as another angle once the needs without one ran out: named.
  const angles: NewResultLine[] = result.angles?.length
    ? [
        {
          key: 'newReason.angles',
          values: {
            count: result.angles.length,
            needs: result.angles.map((a) => a.need).join(', '),
          },
        },
      ]
    : [];
  const done: NewResultMessage = {
    tone: 'success',
    title: { key: 'newDone', values: { generated, duplicates } },
    reasons: angles,
  };
  const scope = result.scope;
  if (!scope) {
    return generated === 0 && duplicates === 0
      ? { tone: 'info', title: { key: 'newNothing' }, reasons: [] }
      : done;
  }
  if (generated >= scope.requested) return done;

  const reasons: NewResultLine[] = [...angles];
  const joined = (result.merged ?? 0) + duplicates + (result.sameQuestion ?? 0);
  if (joined) reasons.push({ key: 'newReason.joined', values: { count: joined } });
  if (scope.noAnswers) {
    reasons.push({ key: 'newReason.noAnswers', values: { count: scope.noAnswers } });
  }
  if (scope.covered) {
    reasons.push({
      key: 'newReason.covered',
      values: { count: scope.covered, focus: scope.focus },
    });
  }
  // Nothing held the rest back: the focus has fewer needs than were asked
  // for, or the model wrote fewer than it was asked for.
  if (reasons.length === angles.length) {
    reasons.push(
      scope.needs < scope.requested
        ? { key: 'newReason.fewNeeds', values: { count: scope.needs, focus: scope.focus } }
        : { key: 'newReason.fewerWritten' },
    );
  }
  return {
    tone: generated ? 'success' : 'info',
    title: generated
      ? { key: 'newPartial', values: { generated, requested: scope.requested } }
      : { key: 'newNone' },
    reasons,
  };
}
