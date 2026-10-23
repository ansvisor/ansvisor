'use client';

import { useEffect, useState } from 'react';
import { runUnderWay, sameRun, type AgentRun, type AgentRunKind } from '@/lib/content/agent-runs';
import { readAgentRun } from '@/lib/content/agent-runs-client';

/** How long after one read of the run the next goes: its steps take a second or more. */
export const RUN_POLL_MS = 1000;

/**
 * The draft's Content Agent run while one is under way (v1.1 CE-027/035),
 * read from the browser while `active` (the editor waits on the agent): its
 * steps as the server writes them. The next read goes a second after the last
 * answered, so slow reads never pile up. Null otherwise, and before the run's
 * first step reads — never an earlier run's steps, nor another kind's (a
 * rewrite still under way when Fix starts, until the server closes it).
 */
export function useAgentRun(
  draftId: string,
  active: boolean,
  kinds: readonly AgentRunKind[],
): AgentRun | null {
  const [run, setRun] = useState<AgentRun | null>(null);
  const kindsKey = kinds.join();
  useEffect(() => {
    if (!active) return;
    const wanted = kindsKey.split(',');
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      const next = await readAgentRun(draftId).catch(() => null);
      if (done) return;
      const shown = next && runUnderWay(next) && wanted.includes(next.kind) ? next : null;
      setRun((last) => (sameRun(last, shown) ? last : shown));
      timer = setTimeout(() => void read(), RUN_POLL_MS);
    };
    void read();
    return () => {
      done = true;
      clearTimeout(timer);
      // The next wait starts from nothing, never this one's last steps.
      setRun(null);
    };
  }, [draftId, active, kindsKey]);
  return active && run && runUnderWay(run) ? run : null;
}
