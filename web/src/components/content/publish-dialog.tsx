'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingDots } from '@/components/ui/loading-dots';
import { publishPage, readPublishAddress, type PublishResult } from '@/lib/content/publish-client';

/**
 * Mark published (CE-013): the person gives the address the page is live
 * at, and tracking starts there (the editor's Live page tab, a linked
 * action's results). It starts from where the page went live, else the page
 * it optimizes, else the brand's site with its slug. From the Library's
 * status menu and the editor; rendered only while open.
 */
export function PublishDialog({
  draftId,
  onClose,
  onPublished,
}: {
  draftId: string;
  onClose: () => void;
  onPublished: (published: Extract<PublishResult, { ok: true }>) => void;
}) {
  const t = useTranslations('contentEditor.publish');
  const tFailure = useTranslations('apiFailure');
  // Undefined while the starting address is read.
  const [url, setUrl] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    readPublishAddress(draftId)
      .catch(() => '')
      .then((address) => {
        if (!cancelled) setUrl((now) => now ?? address);
      });
    return () => {
      cancelled = true;
    };
  }, [draftId]);

  const save = async () => {
    if (!url?.trim()) return;
    setSaving(true);
    setProblem(null);
    const result = await publishPage(draftId, url.trim());
    setSaving(false);
    if (!result.ok) {
      setProblem(
        result.code === 'invalid_url'
          ? t('invalidUrl')
          : result.code === 'session' || result.code === 'workspace' || result.code === 'busy'
            ? tFailure(result.code)
            : t(result.code === 'not_found' ? 'notFound' : 'failed'),
      );
      return;
    }
    if (result.onBrandDomain) toast.success(t('done'));
    else toast.warning(t('offDomain'));
    onPublished(result);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!saving) void save();
          }}
        >
          <Label htmlFor="publish-url">{t('label')}</Label>
          <Input
            id="publish-url"
            type="url"
            inputMode="url"
            autoComplete="url"
            placeholder="https://"
            disabled={url === undefined}
            value={url ?? ''}
            onChange={(e) => {
              setUrl(e.target.value);
              setProblem(null);
            }}
            aria-invalid={problem ? true : undefined}
            aria-describedby="publish-url-hint"
          />
          <p
            id="publish-url-hint"
            role={problem ? 'alert' : undefined}
            className={
              problem ? 'text-xs text-red-700 dark:text-red-400' : 'text-xs text-muted-foreground'
            }
          >
            {problem ?? t('hint')}
          </p>
        </form>
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={saving} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button disabled={saving || !url?.trim()} onClick={() => void save()}>
            {saving && <LoadingDots className="mr-1" />}
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
