'use client';

import { useEffect, useRef, useState } from 'react';
import { checkDraftLinks } from '@/lib/actions/content-drafts';
import type { LinkCheck } from '@/lib/content/quality-checks';

/** How long after a save the links are asked about. */
export const LINK_CHECK_DELAY_MS = 3_000;

/**
 * The page's links as the API reads them (Trust, Quality spec §2.2). The API
 * reads the draft as saved, so the editor asks a few seconds after the links
 * or the save change, for links it has no read of, and keeps each read; the
 * API keeps each a day. A link without a read (not saved yet, an account
 * link the API leaves out, one over its budget, a failed ask) is asked about
 * again only after the next save: until then the checks it would feed leave
 * it out. One the API never reads (an account link) isn't asked about again.
 * The links are compared as the draft saves them (cleanHref).
 *
 * @param hrefs the page's http(s) links now, as it has them
 * @param savedAt when the page was last saved
 */
export function useLinkChecks(
  draftId: string,
  savedAt: string,
  hrefs: string[],
  enabled: boolean,
): Map<string, LinkCheck> {
  const [checks, setChecks] = useState<Map<string, LinkCheck>>(() => new Map());
  // The links read, and the save each other link was last asked about at.
  const read = useRef(new Set<string>());
  const askedAt = useRef(new Map<string, string>());
  // A read that lands after the page changed still counts; only a closed editor drops it.
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);
  const key = hrefs.join('\n');

  useEffect(() => {
    if (!enabled) return;
    const fresh = key
      .split('\n')
      .filter((href) => href && !read.current.has(href) && askedAt.current.get(href) !== savedAt);
    if (!fresh.length) return;
    const timer = setTimeout(() => {
      for (const href of fresh) askedAt.current.set(href, savedAt);
      void checkDraftLinks(draftId).then((result) => {
        if ('error' in result) {
          console.error('Failed to check the draft links:', result.error);
          return;
        }
        if (!open.current) return;
        // A link the API never reads is as good as read: it isn't asked about again.
        for (const href of [...result.links.map((l) => l.href), ...result.skipped]) {
          read.current.add(href);
        }
        setChecks((prev) => {
          const next = new Map(prev);
          for (const link of result.links) next.set(link.href, link);
          return next;
        });
      });
    }, LINK_CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draftId, savedAt, key, enabled]);

  return checks;
}
