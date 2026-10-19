'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  connectIntegration,
  getIntegrationStatus,
  type IntegrationProvider,
  type IntegrationStatus,
} from '@/lib/actions/integrations';

/** How long the popup flow waits for Composio to report the account (#577). */
const CONNECT_DEADLINE_MS = 120_000;
const CONNECT_POLL_MS = 3000;

/**
 * Connect a Google integration in an OAuth popup, polling until Composio
 * reports the account connected. Shared by Settings › Integrations and AI
 * Traffic's data sources strip, so the user connects from where they are
 * and never leaves the page. A blocked popup falls back to the same tab,
 * and `callbackUrl` is where Composio sends them back.
 *
 * `onStatus` hears the outcome: 'connected', or whatever the final check
 * said once the user closed the popup. An unmounted caller stops polling.
 */
export function useIntegrationConnect(
  provider: IntegrationProvider,
  {
    label,
    callbackUrl,
    onStatus,
  }: {
    label: string;
    callbackUrl: () => string;
    onStatus: (status: IntegrationStatus) => void;
  },
) {
  const [connecting, setConnecting] = useState(false);
  // Bumped to stop a poll: a newer attempt, or the caller unmounting.
  const pollGen = useRef(0);

  useEffect(() => {
    const gens = pollGen;
    return () => {
      gens.current++;
    };
  }, []);

  const connect = async () => {
    setConnecting(true);
    const gen = ++pollGen.current;
    try {
      const { redirectUrl } = await connectIntegration(provider, callbackUrl());

      const popup = window.open(redirectUrl, `${provider}-oauth`, 'width=560,height=720');
      if (!popup) {
        // Popup blocked — same-tab fallback; status resolves on return.
        window.location.href = redirectUrl;
        return;
      }

      const deadline = Date.now() + CONNECT_DEADLINE_MS;
      while (Date.now() < deadline && pollGen.current === gen) {
        await new Promise((r) => setTimeout(r, CONNECT_POLL_MS));
        if (pollGen.current !== gen) return;
        try {
          const result = await getIntegrationStatus(provider);
          if (result.status === 'connected') {
            onStatus('connected');
            toast.success(`${label} connected`);
            popup.close();
            return;
          }
        } catch {
          // transient — keep polling until the deadline
        }
        if (popup.closed) {
          // User closed the window — one final check, then give up quietly.
          const result = await getIntegrationStatus(provider).catch(() => null);
          if (pollGen.current !== gen) return;
          onStatus(result?.status ?? 'not_connected');
          if (result?.status === 'connected') {
            toast.success(`${label} connected`);
          }
          return;
        }
      }
      if (pollGen.current === gen) {
        toast.error('Connection timed out — try again.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start connection');
    } finally {
      if (pollGen.current === gen) setConnecting(false);
    }
  };

  return { connecting, connect };
}
