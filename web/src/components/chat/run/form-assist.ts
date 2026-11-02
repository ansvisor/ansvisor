'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import type { FormCardAssist, FormCardValues } from '@/components/agentic/form-card';
import type { ChatConfirmForm } from '@/lib/chat/events';
import { readWhen, whenHint, type WhenWords } from '@/lib/chat/schedule/when';
import { readSkillName } from '@/lib/chat/skills/skill-name';

/**
 * The help an editable card gives as the person types, by what it makes
 * (W3-02): a schedule's When read on their zone's clock, with its next run
 * or why it doesn't read (which keeps Create schedule off), and "Notify only
 * if the answer changed" only on a recurring job. The server reads the same
 * phrase again on Create: this only shows it sooner. A skill's draft (W3-08):
 * why its /name can't be kept (the format, an Ansvisor skill's or a
 * shortcut's name), which keeps Save skill off until it can.
 */
export function useFormAssist(
  form: ChatConfirmForm | undefined,
): ((values: FormCardValues) => FormCardAssist) | undefined {
  const t = useTranslations('chatSchedules.when') as unknown as WhenWords;
  const tSkill = useTranslations('chatSkills.card');
  const kind = form?.kind;
  const zone = form?.zone ?? 'UTC';
  const schedule = useCallback(
    (values: FormCardValues): FormCardAssist => {
      const when = typeof values.when === 'string' ? values.when : '';
      const at = new Date();
      const hint = whenHint(when, zone, at, t);
      const reading = readWhen(when, { now: at, timeZone: zone });
      const recurring = reading.ok && reading.when.kind === 'recurring';
      return {
        hints: { when: hint.ok ? hint.hint : undefined },
        problems: { when: hint.ok ? undefined : hint.hint },
        hidden: recurring ? [] : ['changeOnly'],
      };
    },
    [zone, t],
  );
  const skill = useCallback(
    (values: FormCardValues): FormCardAssist => {
      const { name, problem } = readSkillName(typeof values.name === 'string' ? values.name : '');
      return { problems: { name: problem ? tSkill(problem, { name }) : undefined } };
    },
    [tSkill],
  );
  return kind === 'schedule' ? schedule : kind === 'skill' ? skill : undefined;
}
