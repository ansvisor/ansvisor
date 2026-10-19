'use client';

import { useId, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { ArrowUpRight } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  TASK_DETAIL_LIMITS,
  TASK_TYPES,
  hasTaskSpec,
  isTaskType,
  type ActionTaskDetails,
  type TaskDetailsEdit,
} from '@/lib/action-center/task-details';

/** The type of work, beside the task's text (AC-004). */
export function TaskTypeBadge({ type }: { type: ActionTaskDetails['type'] }) {
  const tTypes = useTranslations('actionCenter.taskTypes');
  if (!type) return null;
  return (
    <Badge variant="outline" className="shrink-0 text-[10px]">
      {tTypes(type)}
    </Badge>
  );
}

/** Where a task can be sent from the drawer (AC-004), and the sending. */
export interface TaskSendOptions {
  /** A content task, on an action that did not come from Content. */
  content: boolean;
  /** The brand has an active webhook. */
  webhook: boolean;
  onSend: (to: 'content' | 'webhook') => void;
}

/**
 * An opened task (AC-004): where to do it, why, how, when it counts as done
 * and what it takes, where it was sent, and for a task sent from the Improve
 * tab its body, platform and evidence (PROMPT-004).
 */
export function TaskDetailView({
  details,
  disabled,
  onEdit,
  send,
}: {
  details: ActionTaskDetails | null;
  disabled: boolean;
  onEdit: () => void;
  send?: TaskSendOptions;
}) {
  const t = useTranslations('actionCenter.actionsPage.drawer.task');
  const format = useFormatter();
  const effort = [details?.effort, details?.role].filter(Boolean).join(' · ');
  const sentContent = details?.sent.content ?? null;
  const sentWebhook = details?.sent.webhook ?? null;

  return (
    <div className="space-y-2 border-t px-4 py-3">
      {details?.body && (
        <p className="text-xs leading-relaxed whitespace-pre-line text-muted-foreground">
          {details.body}
        </p>
      )}
      {details && (details.platformLabel || details.sources.length > 0) && (
        <div className="flex flex-wrap gap-1">
          {details.platformLabel && (
            <Badge variant="secondary" className="text-[10px]">
              {details.platformLabel}
            </Badge>
          )}
          {details.sources.map((source) => (
            <Badge
              key={`${source.type}:${source.ref}`}
              variant="outline"
              title={source.ref}
              className="max-w-full truncate text-[10px] font-normal text-muted-foreground"
            >
              {source.type === 'answer' ? t('answerSource') : source.ref}
            </Badge>
          ))}
        </div>
      )}
      {details && hasTaskSpec(details) ? (
        <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1.5 text-xs">
          {details.where && <Field label={t('where')}>{details.where}</Field>}
          {details.why && <Field label={t('why')}>{details.why}</Field>}
          {details.how.length > 0 && (
            <Field label={t('how')}>
              <ol className="list-decimal space-y-0.5 pl-4">
                {details.how.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </Field>
          )}
          {details.doneWhen && <Field label={t('doneWhen')}>{details.doneWhen}</Field>}
          {effort && <Field label={t('effort')}>{effort}</Field>}
        </dl>
      ) : (
        !details && <p className="text-xs text-muted-foreground">{t('empty')}</p>
      )}
      {(sentContent || sentWebhook) && (
        <div className="space-y-0.5 text-xs text-muted-foreground">
          {sentContent && (
            <p className="flex items-center gap-1">
              {t('sentToContent')}
              <Link
                href={`/dashboard/content?opportunity=${sentContent.opportunityId}`}
                className="inline-flex items-center gap-0.5 font-medium text-foreground underline-offset-2 hover:underline"
              >
                {t('openInContent')}
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            </p>
          )}
          {sentWebhook && (
            <p>
              {t('sentToWebhook', {
                date: format.dateTime(new Date(sentWebhook.at), {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                }),
              })}
            </p>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={onEdit}
          className="h-7 text-xs"
        >
          {t('edit')}
        </Button>
        {send?.content && !sentContent && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => send.onSend('content')}
            className="h-7 text-xs"
          >
            {t('sendToContent')}
          </Button>
        )}
        {send?.webhook && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => send.onSend('webhook')}
            className="h-7 text-xs"
          >
            {sentWebhook ? t('sendToWebhookAgain') : t('sendToWebhook')}
          </Button>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words whitespace-pre-line">{children}</dd>
    </>
  );
}

const NO_TYPE = 'none';

/**
 * Every field of a task, editable (AC-004). The text is saved only when it
 * changed, so a library task keeps rendering from its template in the
 * reader's language.
 */
export function TaskDetailForm({
  text,
  details,
  disabled,
  onSave,
  onCancel,
}: {
  /** The task's text as the drawer shows it. */
  text: string;
  details: ActionTaskDetails | null;
  disabled: boolean;
  onSave: (edit: TaskDetailsEdit & { title: string | null }) => void | Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslations('actionCenter.actionsPage.drawer.task');
  const tTypes = useTranslations('actionCenter.taskTypes');
  const [draft, setDraft] = useState({
    title: text,
    where: details?.where ?? '',
    why: details?.why ?? '',
    how: (details?.how ?? []).join('\n'),
    doneWhen: details?.doneWhen ?? '',
    type: details?.type ?? null,
    effort: details?.effort ?? '',
    role: details?.role ?? '',
  });
  const id = useId();
  const set = (field: keyof typeof draft) => (value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));
  const title = draft.title.trim();

  return (
    <form
      className="space-y-2.5 border-t px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title) return;
        void onSave({
          title: title === text ? null : title,
          where: draft.where,
          why: draft.why,
          how: draft.how.split('\n'),
          doneWhen: draft.doneWhen,
          type: draft.type,
          effort: draft.effort,
          role: draft.role,
        });
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <FormField id={`${id}-what`} label={t('what')}>
        <Input
          id={`${id}-what`}
          autoFocus
          value={draft.title}
          maxLength={200}
          disabled={disabled}
          className="h-8 text-sm"
          onChange={(e) => set('title')(e.target.value)}
        />
      </FormField>
      <FormField id={`${id}-where`} label={t('where')}>
        <Input
          id={`${id}-where`}
          value={draft.where}
          maxLength={TASK_DETAIL_LIMITS.where}
          disabled={disabled}
          className="h-8 text-xs"
          onChange={(e) => set('where')(e.target.value)}
        />
      </FormField>
      <FormField id={`${id}-why`} label={t('why')}>
        <Textarea
          id={`${id}-why`}
          value={draft.why}
          rows={2}
          maxLength={TASK_DETAIL_LIMITS.why}
          disabled={disabled}
          className="min-h-0 text-xs"
          onChange={(e) => set('why')(e.target.value)}
        />
      </FormField>
      <FormField
        id={`${id}-how`}
        label={t('how')}
        hint={t('howHint', { max: TASK_DETAIL_LIMITS.steps })}
      >
        <Textarea
          id={`${id}-how`}
          value={draft.how}
          rows={4}
          maxLength={TASK_DETAIL_LIMITS.step * TASK_DETAIL_LIMITS.steps}
          disabled={disabled}
          className="min-h-0 text-xs"
          onChange={(e) => set('how')(e.target.value)}
        />
      </FormField>
      <FormField id={`${id}-done`} label={t('doneWhen')}>
        <Input
          id={`${id}-done`}
          value={draft.doneWhen}
          maxLength={TASK_DETAIL_LIMITS.doneWhen}
          disabled={disabled}
          className="h-8 text-xs"
          onChange={(e) => set('doneWhen')(e.target.value)}
        />
      </FormField>
      <div className="grid grid-cols-3 gap-2">
        <FormField id={`${id}-type`} label={t('type')}>
          <Select
            value={draft.type ?? NO_TYPE}
            onValueChange={(value) =>
              setDraft((current) => ({ ...current, type: isTaskType(value) ? value : null }))
            }
            disabled={disabled}
            items={[
              { value: NO_TYPE, label: t('noType') },
              ...TASK_TYPES.map((type) => ({ value: type, label: tTypes(type) })),
            ]}
          >
            <SelectTrigger id={`${id}-type`} className="h-8 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_TYPE}>{t('noType')}</SelectItem>
              {TASK_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {tTypes(type)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField id={`${id}-effort`} label={t('effort')}>
          <Input
            id={`${id}-effort`}
            value={draft.effort}
            maxLength={TASK_DETAIL_LIMITS.effort}
            placeholder={t('effortPlaceholder')}
            disabled={disabled}
            className="h-8 text-xs"
            onChange={(e) => set('effort')(e.target.value)}
          />
        </FormField>
        <FormField id={`${id}-role`} label={t('role')}>
          <Input
            id={`${id}-role`}
            value={draft.role}
            maxLength={TASK_DETAIL_LIMITS.role}
            placeholder={t('rolePlaceholder')}
            disabled={disabled}
            className="h-8 text-xs"
            onChange={(e) => set('role')(e.target.value)}
          />
        </FormField>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={disabled || !title} className="h-7 text-xs">
          {t('save')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={onCancel}
          className="h-7 text-xs"
        >
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}

function FormField({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
        {hint && <span className="ml-1 font-normal">· {hint}</span>}
      </Label>
      {children}
    </div>
  );
}
