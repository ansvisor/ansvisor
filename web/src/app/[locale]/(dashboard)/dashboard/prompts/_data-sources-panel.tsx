'use client';

import { useCallback, useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button-variants';
import { BarChart3, Check, Search, Sparkles, X } from 'lucide-react';
import {
  getGaBrandMappings,
  getGscBrandMappings,
  getIntegrationStatus,
  type IntegrationProvider,
} from '@/lib/actions/integrations';

/**
 * What feeds this brand's suggestions, and what could (#659).
 *
 * Suggestions are measurably better when they are mined from the brand's own
 * data — real Search Console demand and real Analytics behaviour instead of
 * modelled guesses — but the connect flow lives in Settings, where nobody
 * stumbles onto it from here. This is the same flow, surfaced where the
 * benefit is visible.
 *
 * A source is only "feeding" when the org is connected AND this brand is
 * mapped to a property. Connected-but-unmapped is the state that silently
 * produces nothing, so it gets its own wording rather than a green tick.
 */

type SourceState = 'not_configured' | 'not_connected' | 'connected_unmapped' | 'feeding';

interface Source {
  provider: IntegrationProvider;
  name: string;
  blurb: string;
  unmappedBlurb: string;
  icon: typeof Search;
  iconClass: string;
  state: SourceState;
}

const SETTINGS_HREF = '/dashboard/settings?tab=integrations';

/** Remembered across visits: a dismissed panel should stay dismissed. */
const DISMISSED_KEY = 'aeo:suggestion-sources-dismissed';

async function resolveState(provider: IntegrationProvider, brandId: string): Promise<SourceState> {
  const status = await getIntegrationStatus(provider);
  if (!status.configured) return 'not_configured';
  if (status.status !== 'connected') return 'not_connected';

  const mappings =
    provider === 'google-search-console'
      ? (await getGscBrandMappings()).map((m) => ({ brandId: m.brandId, mapped: !!m.gscProperty }))
      : (await getGaBrandMappings()).map((m) => ({ brandId: m.brandId, mapped: !!m.gaPropertyId }));

  return mappings.find((m) => m.brandId === brandId)?.mapped ? 'feeding' : 'connected_unmapped';
}

export function DataSourcesPanel({ brandId }: { brandId: string }) {
  const [sources, setSources] = useState<Source[] | null>(null);
  // Read once during the initial render rather than set from an effect: the
  // effect version dismisses on a second pass, so a previously hidden panel
  // flashes into view before disappearing again.
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(DISMISSED_KEY) === '1';
    } catch {
      // Storage unavailable (private mode) — show the panel.
      return false;
    }
  });

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      resolveState('google-search-console', brandId),
      resolveState('google-analytics', brandId),
    ])
      .then(([gsc, ga]) => {
        if (cancelled) return;
        setSources([
          {
            provider: 'google-search-console',
            name: 'Google Search Console',
            blurb: 'Turn the queries your site already ranks for into prompts worth tracking.',
            unmappedBlurb: 'Connected — map this brand to a property to start using its queries.',
            icon: Search,
            iconClass: 'text-blue-500',
            state: gsc,
          },
          {
            provider: 'google-analytics',
            name: 'Google Analytics',
            blurb:
              'Suggest prompts for the pages that earn, and the ones AI already sends visitors to.',
            unmappedBlurb: 'Connected — map this brand to a property to start using its traffic.',
            icon: BarChart3,
            iconClass: 'text-amber-500',
            state: ga,
          },
        ]);
      })
      .catch(() => {
        // Best effort: a status failure must never delay or break the
        // suggestions themselves, so the panel simply stays hidden.
        if (!cancelled) setSources([]);
      });

    return () => {
      cancelled = true;
    };
  }, [brandId]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Preference just won't persist.
    }
  }, []);

  if (dismissed || sources === null) return null;

  // Nothing to advertise: a self-host without Composio credentials cannot
  // complete either flow, so offering it would be a dead end.
  const offerable = sources.filter((s) => s.state !== 'not_configured');
  if (offerable.length === 0) return null;

  // Everything already feeding — the suggestion rows carry their own source
  // badges, so a panel repeating that is noise.
  if (offerable.every((s) => s.state === 'feeding')) return null;

  return (
    <Card className="border-dashed">
      <CardContent className="relative flex flex-col gap-4 p-4 lg:flex-row lg:items-stretch">
        <button
          type="button"
          onClick={dismiss}
          aria-label="Hide data sources"
          className="absolute right-3 top-3 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex max-w-xs items-start gap-3 lg:pr-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Sparkles className="h-4 w-4 text-primary" />
          </span>
          <div className="space-y-1">
            <p className="text-sm font-medium leading-snug">Make these suggestions yours</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Connect your own data and suggestions come from real demand and real behaviour instead
              of estimates.
            </p>
          </div>
        </div>

        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          {offerable.map((source) => {
            const Icon = source.icon;
            const feeding = source.state === 'feeding';
            return (
              <div
                key={source.provider}
                className="flex flex-col gap-2 rounded-lg border bg-card p-3"
              >
                <div className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 shrink-0 ${source.iconClass}`} />
                  <span className="text-sm font-medium">{source.name}</span>
                </div>
                <p className="flex-1 text-xs text-muted-foreground leading-relaxed">
                  {source.state === 'connected_unmapped' ? source.unmappedBlurb : source.blurb}
                </p>
                {feeding ? (
                  <span className="flex items-center gap-1.5 text-xs font-medium text-green-600 dark:text-green-400">
                    <Check className="h-3.5 w-3.5" />
                    Feeding suggestions
                  </span>
                ) : (
                  <Link
                    href={SETTINGS_HREF}
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    {source.state === 'connected_unmapped' ? 'Map property' : 'Connect'}
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
