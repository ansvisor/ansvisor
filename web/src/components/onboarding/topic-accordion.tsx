'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, ChevronDown, ChevronRight, MoreHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { TopicPromptPicks } from '@/lib/onboarding-prompt-picks';

// A topic's suggested prompts, each ticked or not: a checklist.
type TopicPromptsData = TopicPromptPicks;

export function TopicAccordion({
  data,
  defaultOpen = false,
  onRemoveTopic,
  onAddPrompt,
  onTogglePrompt,
}: {
  data: TopicPromptsData;
  defaultOpen?: boolean;
  onRemoveTopic: () => void;
  onAddPrompt: (prompt: string) => void;
  onTogglePrompt: (index: number) => void;
}) {
  const t = useTranslations('onboarding.prompts');
  const [open, setOpen] = useState(defaultOpen);
  const [newPrompt, setNewPrompt] = useState('');

  const handleAdd = () => {
    const trimmed = newPrompt.trim();
    if (trimmed.length >= 10) {
      onAddPrompt(trimmed);
      setNewPrompt('');
    }
  };

  return (
    <div className="border-b last:border-b-0">
      <div className="flex items-center gap-3 py-3 px-1">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 flex-1 text-left text-sm"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          <span className="font-medium">{data.topic}</span>
          <span className="text-xs text-muted-foreground">
            {t('topicCount', {
              picked: data.prompts.filter((p) => p.picked).length,
              total: data.prompts.length,
            })}
          </span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger className="p-1 rounded hover:bg-muted text-muted-foreground">
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={onRemoveTopic}
            >
              {t('removeTopic')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {open && (
        <div className="pl-7 pb-3 space-y-1.5">
          {data.prompts.map((p, idx) => (
            <label
              key={idx}
              data-slot="prompt-pick"
              className={cn(
                'flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2',
                p.picked ? 'bg-muted/30' : 'text-muted-foreground',
              )}
            >
              <Checkbox checked={p.picked} onCheckedChange={() => onTogglePrompt(idx)} />
              <span className="text-sm flex-1">{p.text}</span>
            </label>
          ))}
          <div className="flex items-center gap-2 mt-2">
            <Input
              placeholder={t('newPromptPlaceholder')}
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              className="text-sm h-9"
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={handleAdd}
              disabled={newPrompt.trim().length < 10}
              className="h-9 px-2"
            >
              <Check className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setNewPrompt('')} className="h-9 px-2">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
