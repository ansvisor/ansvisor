'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Code, Copy } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getPublicApiBaseUrl } from '@/config/api';

/** The tracking snippet tag for a brand, or null without a code or an API URL. */
function snippetTag(trackingCode?: string): string | null {
  const apiUrl = getPublicApiBaseUrl();
  if (!trackingCode || !apiUrl) return null;
  return `<script src="${apiUrl}/t.js" data-t="${trackingCode}" defer></script>`;
}

/** Where the tag goes, the tag, and a copy button. */
function SnippetCode({ snippet }: { snippet: string }) {
  const t = useTranslations('traffic');
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">
          {t.rich('snippetDescription', {
            tag: '</head>',
            code: (chunks) => <code className="text-[11px]">{chunks}</code>,
          })}
        </p>
        <pre className="mt-2 overflow-x-auto rounded-md bg-muted/50 px-3 py-2 font-mono text-[11px]">
          {snippet}
        </pre>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={handleCopy}
        aria-label={t('copySnippet')}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-500" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  );
}

/**
 * The snippet's code, open on the page: only while the snippet hasn't sent a
 * visit in the last week (AT-001). Once it has, the code sits behind the
 * sources strip's Code button instead of staying at the top for good.
 */
export function SnippetBanner({ trackingCode }: { trackingCode?: string }) {
  const t = useTranslations('traffic');
  const snippet = snippetTag(trackingCode);
  if (!snippet) return null;

  return (
    <Card className="border-blue-500/20 bg-blue-500/5">
      <CardContent className="flex items-start gap-3 px-4 py-3">
        <Code className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
        <div className="min-w-0 flex-1">
          <p className="mb-0.5 text-sm font-medium">{t('snippetTitle')}</p>
          <SnippetCode snippet={snippet} />
        </div>
      </CardContent>
    </Card>
  );
}

/** The snippet's code in a dialog, from the sources strip's Code or Install button. */
export function SnippetDialog({
  trackingCode,
  open,
  onOpenChange,
}: {
  trackingCode?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('traffic');
  const snippet = snippetTag(trackingCode);
  if (!snippet) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('snippetTitle')}</DialogTitle>
        </DialogHeader>
        <SnippetCode snippet={snippet} />
      </DialogContent>
    </Dialog>
  );
}
