'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { LOCALE_NAMES, isAnyUiLocale } from '@/i18n/locales';
import { reviewTranslationSuggestion } from '@/lib/actions/translation-suggestions-review';
import { formatDateTime } from '@/lib/format';

export interface SuggestionRow {
  id: string;
  locale: string;
  path: string;
  message_key: string | null;
  current_text: string;
  suggestion: string;
  note: string;
  created_at: string;
}

/**
 * The staff's list of new suggested translations (LOC-009), oldest first.
 * Accept only marks the row: the string in messages/<locale>.json and the
 * glossary are changed by hand, by running web/scripts/translate-messages.mjs
 * again (branch feature/loc-translate). A reviewed row leaves the list.
 */
export function TranslationSuggestionsAdmin({ rows }: { rows: SuggestionRow[] }) {
  const t = useTranslations('translationSuggestionsAdmin');
  const [left, setLeft] = useState(rows);
  const [busy, setBusy] = useState<string | null>(null);

  async function review(id: string, decision: 'accepted' | 'rejected') {
    setBusy(id);
    try {
      const { ok } = await reviewTranslationSuggestion(id, decision);
      if (ok) {
        toast.success(t(decision));
      } else {
        toast.error(t('failed'));
      }
      // Reviewed, or already so by someone else: either way it leaves the list.
      setLeft((current) => current.filter((row) => row.id !== id));
    } catch {
      toast.error(t('failed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
      </div>

      {left.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.date')}</TableHead>
              <TableHead>{t('columns.language')}</TableHead>
              <TableHead>{t('columns.screen')}</TableHead>
              <TableHead>{t('columns.current')}</TableHead>
              <TableHead>{t('columns.suggestion')}</TableHead>
              <TableHead>{t('columns.note')}</TableHead>
              <TableHead className="text-end">{t('columns.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {left.map((row) => (
              <TableRow key={row.id} data-suggestion-id={row.id} className="align-top">
                <TableCell className="whitespace-nowrap">
                  {formatDateTime(row.created_at)}
                </TableCell>
                <TableCell>
                  {isAnyUiLocale(row.locale) ? LOCALE_NAMES[row.locale] : row.locale}
                </TableCell>
                <TableCell className="font-mono text-xs break-all">{row.path || '–'}</TableCell>
                <TableCell className="max-w-64 whitespace-normal">
                  {row.current_text}
                  {row.message_key && (
                    <div className="mt-1 font-mono text-xs text-muted-foreground">
                      {t('key', { key: row.message_key })}
                    </div>
                  )}
                </TableCell>
                <TableCell className="max-w-64 whitespace-normal">{row.suggestion}</TableCell>
                <TableCell className="max-w-64 whitespace-normal text-muted-foreground">
                  {row.note || '–'}
                </TableCell>
                <TableCell className="text-end whitespace-nowrap">
                  <Button
                    size="sm"
                    disabled={busy === row.id}
                    onClick={() => void review(row.id, 'accepted')}
                  >
                    {t('accept')}
                  </Button>{' '}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === row.id}
                    onClick={() => void review(row.id, 'rejected')}
                  >
                    {t('reject')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
