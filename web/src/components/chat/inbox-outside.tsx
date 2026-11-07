'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Paperclip } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';
import {
  cancelOutsideEmail,
  sendOutsideEmail,
  type OutsideEmail,
  type OutsideEmailResult,
} from '@/lib/actions/chat-outbound';
import { cn } from '@/lib/utils';

/**
 * A scheduled job's e-mails to people outside the workspace, waiting in
 * Needs you (W4-28, Chat Wave 4 decision 16): "Send to jane@client.com",
 * the job, what the e-mail says (its subject, the answer's first lines and
 * the PDF attached), when it expires, then Send and Cancel. Each Send is
 * the person's own click, every time: a run never sends one, Full auto
 * neither. A card that went, was cancelled or expired leaves the list.
 */
export function OutsideEmailRows({ emails }: { emails: OutsideEmail[] }) {
  const router = useRouter();
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  return emails
    .filter((email) => !gone.has(email.id))
    .map((email) => (
      <OutsideEmailRow
        key={email.id}
        email={email}
        onGone={() => {
          setGone((ids) => new Set(ids).add(email.id));
          // The Inbox's counts read again.
          router.refresh();
        }}
      />
    ));
}

/** Refusals after which the card has nothing left to do. */
const SETTLED = new Set(['sent', 'cancelled', 'expired', 'removed', 'not_found']);
/** The server's codes the card has words for (chatShell.inbox.outside.errors). */
const KNOWN = new Set([
  'forbidden',
  'trial',
  'plan',
  'daily_limit',
  'busy',
  'signed_out',
  ...SETTLED,
]);

const dayOf = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const sizeOf = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

function OutsideEmailRow({ email, onGone }: { email: OutsideEmail; onGone: () => void }) {
  const t = useTranslations('chatShell.inbox.outside');
  const [busy, setBusy] = useState<'send' | 'cancel' | null>(null);
  const [problem, setProblem] = useState<string | null>(email.sendError);

  const act = async (kind: 'send' | 'cancel') => {
    setBusy(kind);
    try {
      const result: OutsideEmailResult = await (
        kind === 'send' ? sendOutsideEmail(email.id) : cancelOutsideEmail(email.id)
      ).catch(() => ({ ok: false as const, code: 'failed' }));
      if (result.ok) {
        toast.success(t(kind === 'send' ? 'sent' : 'cancelled', { to: email.to }));
        onGone();
        return;
      }
      const words =
        result.message ?? t(`errors.${KNOWN.has(result.code) ? result.code : 'failed'}`);
      if (SETTLED.has(result.code)) {
        toast.error(words);
        onGone();
      } else {
        setProblem(words);
        toast.error(words);
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      data-slot="inbox-outside-email"
      className="grid gap-2.5 rounded-[14px] border border-amber-200 bg-amber-50/40 px-[13px] py-[11px] shadow-[0_1px_2px_rgba(10,10,10,.04)] dark:border-amber-900 dark:bg-amber-950/20"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-1.5 size-2 shrink-0 rounded-full bg-amber-600 dark:bg-amber-400"
        />
        <span className="min-w-0 flex-1 text-[13.5px]">
          <span className="block truncate font-semibold">{t('title', { to: email.to })}</span>
          <span className="block truncate text-xs text-amber-700 dark:text-amber-400">
            {t('line', { job: email.title, date: dayOf(email.expiresAt) })}
          </span>
        </span>
      </div>
      <div className="rounded-lg border bg-card px-3 py-2.5 text-[13px]">
        <span className="block text-xs text-muted-foreground">
          {t('subject')} <span className="font-medium text-foreground">{email.subject}</span>
        </span>
        {email.summary.length > 0 && (
          <ul className="mt-1.5 mb-0 list-disc pl-5">
            {email.summary.map((line, i) => (
              <li key={i} className="mb-0.5">
                {line}
              </li>
            ))}
          </ul>
        )}
        {email.files.length > 0 && (
          <ul className="mt-2 mb-0 flex list-none flex-wrap gap-1.5 p-0">
            {email.files.map((file) => (
              <li
                key={file.name}
                className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2.5 py-0.5 text-[12px]"
              >
                <Paperclip aria-hidden className="size-3 text-muted-foreground" />
                {file.name}
                {file.bytes > 0 && (
                  <span className="text-muted-foreground"> · {sizeOf(file.bytes)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <span className="mt-2 block text-xs text-muted-foreground">{t('footer')}</span>
      </div>
      {problem && (
        <p role="alert" className="m-0 text-xs text-red-700 dark:text-red-300">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-1.5">
        <Button
          variant="outline"
          size="sm"
          data-action="inbox.cancelOutsideEmail"
          disabled={busy !== null}
          onClick={() => void act('cancel')}
        >
          {t('cancel')}
        </Button>
        <Button
          size="sm"
          data-action="inbox.sendOutsideEmail"
          disabled={busy !== null}
          onClick={() => void act('send')}
          className={cn(busy === 'send' && 'opacity-80')}
        >
          {busy === 'send' ? t('sending') : t('send')}
        </Button>
      </div>
    </div>
  );
}
