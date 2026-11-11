'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  suggestPromptsFromBusinessHub,
  type BusinessHubTopicsResult,
} from '@/lib/actions/prompt-suggestions';
import { getLocationQuota } from '@/lib/actions/prompt';
import { NO_TOPICS } from '@/lib/topics-required';
import { useFailureToast } from '@/hooks/use-failure-toast';

/** Business Hub shows five discovery topics; a topic is kept to 120 characters. */
const TOPIC_FIELDS = 5;
const TOPIC_CHARS = 120;

const FORM_ID = 'business-hub-topics';

const emptyTopics = () => Array.from({ length: TOPIC_FIELDS }, () => '');

interface Props {
  brandId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The suggestions written, to list them at once. */
  onAdded: (result: BusinessHubTopicsResult) => void;
  /** The brand has no topic yet: the card asks for one first. */
  onNoTopics: () => void;
  /**
   * Topics to start from. None yet: prefilling from the brand's latest
   * Business Hub numbers follows once those are stored.
   */
  initialTopics?: string[];
}

/**
 * From ChatGPT Business Hub (Business Hub plan, PR 6): up to five discovery
 * topics copied from Business Hub's Insights, and how many more prompts the
 * plan can track. Ansvisor writes two or three prompts for each; the result
 * says how many were added and what was left out, and the list then shows
 * them under the ChatGPT Business Hub filter.
 */
export function BusinessHubTopicsDialog({
  brandId,
  open,
  onOpenChange,
  onAdded,
  onNoTopics,
  initialTopics,
}: Props) {
  const t = useTranslations('prompts.suggestions.businessHub');
  const failureToast = useFailureToast();
  const [topics, setTopics] = useState<string[]>(emptyTopics);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BusinessHubTopicsResult | null>(null);
  // How many more prompts the plan tracks: null while unknown, -1 unlimited.
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const start = emptyTopics();
    (initialTopics ?? []).slice(0, TOPIC_FIELDS).forEach((topic, i) => {
      start[i] = topic.slice(0, TOPIC_CHARS);
    });
    setTopics(start);
    setResult(null);
    setLeft(null);
    let cancelled = false;
    // The numbers each prompt's plan check reads; unread, the line is left out.
    getLocationQuota(brandId)
      .then((q) => {
        if (!cancelled) setLeft(q.maxPrompts < 0 ? -1 : Math.max(0, q.maxPrompts - q.used));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, brandId, initialTopics]);

  const given = topics.map((topic) => topic.trim()).filter(Boolean);

  const submit = async () => {
    if (given.length === 0 || busy) return;
    setBusy(true);
    try {
      const answer = await suggestPromptsFromBusinessHub(brandId, given);
      if (answer.ok) {
        setResult(answer.result);
        onAdded(answer.result);
      } else if (answer.failure === NO_TOPICS) {
        onOpenChange(false);
        onNoTopics();
      } else {
        failureToast(answer.failure);
      }
    } catch {
      // The request to Next itself failed: production hides why.
      failureToast('failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('dialog.title')}</DialogTitle>
          <DialogDescription>{t('dialog.description')}</DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3 text-sm" role="status">
            <p className="font-medium">{t('result.added', { count: result.added })}</p>
            {result.alreadyTracked + result.alreadySuggested > 0 && (
              <p className="text-muted-foreground">
                {t('result.skipped', {
                  tracked: result.alreadyTracked,
                  suggested: result.alreadySuggested,
                })}
              </p>
            )}
            <ul className="space-y-1.5">
              {result.topics.map((topic) => (
                <li key={topic.topic} className="flex items-start justify-between gap-3">
                  <span className="min-w-0 break-words">{topic.topic}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {topic.matchedTopic
                      ? t('result.topicMatched', {
                          count: topic.added,
                          topic: topic.matchedTopic,
                        })
                      : t('result.topicNew', { count: topic.added })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <form
            id={FORM_ID}
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            {topics.map((topic, i) => (
              <div key={i} className="space-y-1">
                <label
                  htmlFor={`business-hub-topic-${i}`}
                  className="text-xs text-muted-foreground"
                >
                  {t('dialog.topicLabel', { number: i + 1 })}
                </label>
                <Input
                  id={`business-hub-topic-${i}`}
                  value={topic}
                  maxLength={TOPIC_CHARS}
                  disabled={busy}
                  placeholder={i === 0 ? t('dialog.topicPlaceholder') : undefined}
                  onChange={(e) =>
                    setTopics((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
                  }
                />
              </div>
            ))}
            {left !== null && left >= 0 && (
              <p className="text-xs text-muted-foreground">
                {left > 0 ? t('dialog.quota', { count: left }) : t('dialog.quotaFull')}
              </p>
            )}
          </form>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={() => onOpenChange(false)}>{t('result.done')}</Button>
          ) : (
            <>
              <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
                {t('dialog.cancel')}
              </Button>
              {/* The form's own button, so Enter in any field sends it. */}
              <Button
                type="submit"
                form={FORM_ID}
                disabled={busy || given.length === 0}
                className="gap-2"
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {busy ? t('dialog.submitting') : t('dialog.submit')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
