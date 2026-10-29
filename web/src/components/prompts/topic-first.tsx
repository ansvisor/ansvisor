'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Tag } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ADD_TOPIC_HREF } from '@/lib/topics-required';
import { cn } from '@/lib/utils';

/**
 * Prompts are grouped under topics, so a brand with none can't add prompts
 * or have them suggested. Where someone tries, they are told so and sent to
 * the Topics tab with Add Topic open; back here, the same button works, as
 * every flow reads the brand's topics again. The buttons stay visible: the
 * person learns what is missing by using them.
 */

/** "Add a topic": the Prompts page's Topics tab, with its Add Topic dialog open. */
export function AddTopicLink({ onClick }: { onClick?: () => void }) {
  const t = useTranslations('topicFirst');
  return (
    <Link href={ADD_TOPIC_HREF} className={buttonVariants({ size: 'sm' })} onClick={onClick}>
      <Plus />
      {t('addTopic')}
    </Link>
  );
}

/** The same words inside the card or dialog the person was in, as its plan-limit note is. */
export function TopicFirstNotice({ className }: { className?: string }) {
  const t = useTranslations('topicFirst');
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/30',
        className,
      )}
    >
      <Tag className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
      <div className="space-y-1">
        <p className="font-medium text-amber-900 dark:text-amber-200">{t('title')}</p>
        <p className="text-amber-800/80 dark:text-amber-300/80">{t('body')}</p>
      </div>
    </div>
  );
}

/** For a button that had nothing of its own to show it in: a click answered `no_topics`. */
export function TopicFirstDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('topicFirst');
  const common = useTranslations('common');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('body')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" size="sm" />}>
            {common('cancel')}
          </DialogClose>
          <AddTopicLink onClick={() => onOpenChange(false)} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The dialog and its opener for one component: render `dialog` once and call
 * `show()` when a write or a generation comes back `no_topics`.
 */
export function useTopicFirstDialog() {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  return { show, dialog: <TopicFirstDialog open={open} onOpenChange={setOpen} /> };
}
