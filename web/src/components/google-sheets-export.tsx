'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Link } from '@/i18n/navigation';
import { spreadsheetCell } from '@/lib/csv';
import { readSheetStatus, writeGoogleSheet } from '@/lib/integrations-client';

export interface ExportTable {
  headers: string[];
  rows: Record<string, unknown>[];
}

export function GoogleSheetsExport({
  brandId,
  view,
  disabled,
  table,
}: {
  brandId: string;
  view: 'Prompts' | 'Citations' | 'Content Opportunities';
  disabled: boolean;
  table: () => ExportTable | Promise<ExportTable>;
}) {
  const t = useTranslations('sheets');
  const [status, setStatus] = useState<{ configured: boolean; accountId: string | null }>();
  const [open, setOpen] = useState(false);
  const [destination, setDestination] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  useEffect(() => {
    let active = true;
    void readSheetStatus(brandId).then((result) => {
      if (active && result.ok) setStatus(result.value);
    });
    return () => {
      active = false;
    };
  }, [brandId]);
  if (!status?.configured) return null;
  const key = ['ansvisor-sheets', brandId, view, status.accountId].join(':');
  function show() {
    setError('');
    setUrl('');
    setDestination('');
    try {
      setDestination(localStorage.getItem(key) ?? '');
    } catch {
      /* Storage is optional. */
    }
    setOpen(true);
  }
  async function send() {
    if (disabled || !status?.accountId || sending.current) return;
    const target = destination.trim();
    const id =
      /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]{1,200})(?:[/?#].*)?$/.exec(
        target,
      )?.[1];
    if (target && !id) {
      setError(t('invalid'));
      return;
    }
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      const { headers, rows } = await table();
      const values = [
        headers,
        ...rows.map((row) => headers.map((header) => spreadsheetCell(row[header]))),
      ];
      const result = await writeGoogleSheet(brandId, {
        accountId: status.accountId,
        view,
        values,
        spreadsheetId: id,
      });
      if (!result.ok) throw new Error();
      setUrl(result.value);
      try {
        localStorage.setItem(key, result.value);
      } catch {
        /* Export already succeeded. */
      }
    } catch {
      setError(t('failed'));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Button variant="outline" disabled={disabled} onClick={show}>
        {t('export')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('export')}</DialogTitle>
            <DialogDescription>{t('hint')}</DialogDescription>
          </DialogHeader>
          {!status.accountId ? (
            <Link href={'/dashboard/brands/' + brandId + '/settings?tab=integrations'}>
              {t('connect')}
            </Link>
          ) : url ? (
            <a href={url} target="_blank" rel="noreferrer">
              {t('open')}
            </a>
          ) : (
            <>
              <label>
                {t('destination')}
                <Input
                  value={destination}
                  onChange={(event) => setDestination(event.target.value)}
                  disabled={busy}
                />
              </label>
              {error && <p role="alert">{error}</p>}
              <Button onClick={send} disabled={busy || disabled}>
                {t(busy ? 'busy' : 'send')}
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
