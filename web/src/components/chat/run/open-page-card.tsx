'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FileText } from 'lucide-react';
import { AgentCard, AgentCardBody, AgentCardHeader } from '@/components/agentic/agent-card';
import { Checkbox } from '@/components/ui/checkbox';
import type { PageOpen } from '@/lib/chat/page-open';

/** A choice the card makes: the editor, or staying in the chat. */
export type OpenPageChoice = Exclude<PageOpen, 'ask'>;

/**
 * "Where should we open this page?" (CHAT-25 §3, mockup #e-open; W4-11):
 * after Chat writes a page, the person picks the Content Editor (the full
 * editor with Brief, Rules and Quality) or keeps working in the chat. No
 * choice is marked Recommended (owner). "Don't ask again" keeps the choice
 * as theirs (Settings › Chat › Where pages open). "Open here", the editor
 * beside the chat, comes with W4-15. Key 1 picks the editor.
 */
export function OpenPageCard({
  saving = false,
  onChoose,
}: {
  saving?: boolean;
  onChoose: (choice: OpenPageChoice, remember: boolean) => void;
}) {
  const t = useTranslations('chatRun.openPage');
  const titleId = useId();
  const [remember, setRemember] = useState(false);
  return (
    <AgentCard
      tone="needsYou"
      aria-labelledby={titleId}
      data-slot="open-page-card"
      onKeyDown={(event) => {
        if (event.key === '1' && !saving) onChoose('editor', remember);
      }}
    >
      <AgentCardHeader
        titleId={titleId}
        lead={<FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
        title={t('question')}
      />
      <AgentCardBody className="grid gap-1.5 pt-2.5">
        <button
          type="button"
          data-action="openPage.editor"
          disabled={saving}
          onClick={() => onChoose('editor', remember)}
          className="grid min-h-[44px] w-full grid-cols-[22px_minmax(0,1fr)] items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left text-[13px] outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <kbd
            aria-hidden
            className="flex size-[22px] items-center justify-center rounded-md border font-sans text-[11.5px] text-muted-foreground"
          >
            1
          </kbd>
          <span className="min-w-0">
            <span className="font-medium">{t('editor')}</span>
            <span className="block text-xs text-muted-foreground">{t('editorDetail')}</span>
          </span>
        </button>
        <button
          type="button"
          data-action="openPage.chat"
          disabled={saving}
          onClick={() => onChoose('chat', remember)}
          className="w-fit rounded-md px-1 py-1 text-left text-[13px] outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span className="font-medium">{t('chat')}</span>
          <span className="text-muted-foreground"> · {t('chatDetail')}</span>
        </button>
        <label className="mt-1 flex w-fit items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            data-action="openPage.dontAskAgain"
            checked={remember}
            disabled={saving}
            onCheckedChange={(checked) => setRemember(checked === true)}
          />
          {t('dontAskAgain')}
        </label>
      </AgentCardBody>
    </AgentCard>
  );
}
