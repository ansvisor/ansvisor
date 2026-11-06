'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Settings2 } from 'lucide-react';
import { getAgentWorkView, setAgentWork } from '@/lib/actions/chat-settings';
import type { AgentWork, AgentWorkView } from '@/lib/chat/agent-work';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AgentWorkPanel } from '@/components/chat-access/agent-work-panel';

/**
 * The gear on Action Center › Today (AC-011, mockup screen 3): "Agent work"
 * opens who starts agent work. It shows only where Chat is on (its agents
 * are Chat's); an Admin saves, everyone else reads.
 */
export function AgentWorkGear() {
  const t = useTranslations('actionCenter.agentWork');
  const [view, setView] = useState<AgentWorkView | null>(null);
  const [version, setVersion] = useState(0);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    getAgentWorkView()
      .then((result) => {
        if (live && result.ok) setView(result.view);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [version]);

  if (!view) return null;

  const save = async (value: AgentWork) => {
    setSaving(true);
    try {
      const result = await setAgentWork(value);
      if (result.ok) {
        toast.success(t('saved'));
        setOpen(false);
      } else {
        toast.error(t(`failures.${result.failure}`));
      }
    } catch {
      toast.error(t('failures.failed'));
    } finally {
      setSaving(false);
      setVersion((n) => n + 1);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        title={t('gearHint')}
        className="ml-auto inline-flex h-7 shrink-0 items-center gap-1.5 self-center rounded-lg border px-2 text-xs text-muted-foreground outline-none hover:bg-muted/50 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Settings2 className="h-3.5 w-3.5" aria-hidden />
        {t('gear')}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <AgentWorkPanel
          key={`${view.value}:${view.lastChange?.at ?? ''}`}
          view={view}
          saving={saving}
          onSave={(value) => void save(value)}
        />
      </PopoverContent>
    </Popover>
  );
}
