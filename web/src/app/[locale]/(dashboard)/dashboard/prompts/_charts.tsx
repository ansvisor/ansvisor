'use client';

import { useRef, useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts';
import { formatCompactNumber } from '@/lib/format';

// ─── Auto-sizing wrapper ─────────────────────────────────────────────────────

function ChartContainer({
  height,
  children,
}: {
  height: number;
  children: (width: number) => React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ width: '100%', height }}>
      {width > 0 && children(width)}
    </div>
  );
}

// ─── Exported Charts ──────────────────────────────────────────────────────────

interface PlatformVolumeItem {
  name: string;
  share: number;
  volume: number;
  color: string;
}

/**
 * Estimated share of AI-answered search queries across major answer engines.
 *
 * Derivation (all daily volume figures, early 2026):
 *   • Google Search:            ~16.4B searches/day  (ExplodingTopics, Feb 2026)
 *   • AI Overview coverage:     ~35% of Google searches  (Semrush / Pew estimates)
 *     → AI Overview volume:     ~5.74B/day
 *   • Google AI Mode:           ~100M MAU / ~1B monthly queries (Alphabet Q2 2025
 *     disclosures, 2026 industry estimates), still below Gemini app scale
 *   • ChatGPT:                  ~2.5B prompts/day  (Ahrefs, Jul 2025)
 *   • Other chatbots combined:  ~1.13B/day, split using the blended standalone
 *     chatbot market share average from Statcounter (Mar 2026),
 *     Similarweb (Jan 2026) and FirstPageSage (Apr 2026).
 *
 * Unlike raw chatbot-only market-share charts, this distribution reflects the
 * "any query that gets an AI-generated answer" universe — which is the
 * relevant denominator for Answer Engine Optimisation (AEO). Shares sum to 1.
 */
export const AI_PLATFORM_SHARES: {
  name: string;
  share: number;
  color: string;
}[] = [
  { name: 'Google AI Overview', share: 0.602, color: '#4285f4' },
  { name: 'ChatGPT', share: 0.27, color: '#10a37f' },
  { name: 'Google Gemini', share: 0.055, color: '#8ab4f8' },
  { name: 'Microsoft Copilot', share: 0.029, color: '#0ea5e9' },
  { name: 'Perplexity', share: 0.018, color: '#6366f1' },
  { name: 'Claude', share: 0.013, color: '#d97706' },
  { name: 'Google AI Mode', share: 0.008, color: '#1a73e8' },
  { name: 'Grok', share: 0.005, color: '#18181b' },
];

export function PlatformVolumeChart({ totalVolume }: { totalVolume: number }) {
  if (totalVolume <= 0) {
    return (
      <div className="flex items-center justify-center h-[220px] text-xs text-muted-foreground">
        No volume data available
      </div>
    );
  }

  const data: PlatformVolumeItem[] = AI_PLATFORM_SHARES.map((p) => ({
    name: p.name,
    share: p.share,
    volume: Math.round(totalVolume * p.share),
    color: p.color,
  })).sort((a, b) => b.volume - a.volume);

  return (
    <ChartContainer height={220}>
      {(width) => (
        <BarChart
          width={width}
          height={220}
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 12, left: 4, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            className="fill-muted-foreground"
            tickFormatter={formatCompactNumber}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            className="fill-muted-foreground"
            width={120}
          />
          <Tooltip
            cursor={{ fill: 'hsl(var(--muted)/0.4)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0].payload as PlatformVolumeItem;
              return (
                <div className="rounded-lg border bg-background px-3 py-2 shadow-md text-xs">
                  <p className="font-medium text-foreground mb-0.5">{row.name}</p>
                  <p className="text-muted-foreground">
                    Est. queries:{' '}
                    <span className="font-medium text-foreground">
                      {row.volume.toLocaleString()}
                    </span>
                  </p>
                  <p className="text-muted-foreground">
                    Share:{' '}
                    <span className="font-medium text-foreground">
                      {(row.share * 100).toFixed(0)}%
                    </span>
                  </p>
                </div>
              );
            }}
          />
          <Bar dataKey="volume" radius={[0, 4, 4, 0]}>
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      )}
    </ChartContainer>
  );
}
