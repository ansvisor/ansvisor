'use client';

import { useRef, useState, useEffect } from 'react';
import { PLATFORM_LABELS } from '@/config/platform-labels';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from 'recharts';
import type {
  CompetitorComparisonEntry,
  ProviderComparisonRow,
  VisibilityTrendPoint,
  SoVByPlatform,
  SoVTrendPoint,
} from '@/lib/actions/tracking';

// ─── Adaptive Y-axis ─────────────────────────────────────────────────────────
// Visibility scores are theoretically 0–100 but realistic values for most
// brands cluster in the 5–30 band. Pinning the Y-axis to 100 makes bars look
// uniformly stubby and kills the perceived difference between, say, 8 and 22.
// We rescale upward with 30% headroom, but snap to a "nice" tick value so
// gridlines stay clean — and keep a minimum ceiling of 20 so very low values
// don't look absurdly zoomed (a 3-point chart shouldn't fill the canvas).

const NICE_YMAX_STEPS = [20, 25, 30, 40, 50, 60, 80, 100] as const;

function niceVisibilityYMax(values: number[]): number {
  if (values.length === 0) return 20;
  const actualMax = Math.max(0, ...values);
  if (actualMax <= 0) return 20;
  const target = actualMax * 1.3;
  for (const step of NICE_YMAX_STEPS) if (target <= step) return step;
  return 100;
}

// ─── Auto-sizing wrapper ─────────────────────────────────────────────────────
// Replaces ResponsiveContainer which has issues with React 19

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

// ─── Data ─────────────────────────────────────────────────────────────────────

const DEFAULT_PLATFORM_DATA = [
  { name: 'Perplexity', value: 72, color: '#6366f1' },
  { name: 'ChatGPT', value: 58, color: '#8b5cf6' },
  { name: 'Claude', value: 49, color: '#a78bfa' },
  { name: 'Gemini', value: 41, color: '#c4b5fd' },
  { name: 'Copilot', value: 35, color: '#ddd6fe' },
];

const PLATFORM_COLORS: Record<string, string> = {
  chatgpt: '#8b5cf6',
  gemini: '#c4b5fd',
  perplexity: '#6366f1',
  claude: '#a78bfa',
  grok: '#f59e0b',
  copilot: '#ddd6fe',
  'meta-ai': '#3b82f6',
  'google-ai-overviews': '#22c55e',
  'google-ai-mode': '#4285f4',
  'google-aimode': '#4285f4',
  'gpt-5-chat-latest': '#8b5cf6',
  'gpt-5-mini': '#a78bfa',
  'claude-sonnet-5': '#fb923c',
  'claude-sonnet-4-6': '#f97316',
  'claude-opus-4-6': '#ea580c',
  'gemini-2.5-pro': '#22c55e',
  'gemini-2.5-flash': '#4ade80',
};

// ─── Custom Tooltips ──────────────────────────────────────────────────────────

function AreaTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background px-3 py-2 shadow-md text-xs">
      <p className="font-medium text-foreground mb-1">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground capitalize">{entry.name}:</span>
          <span className="font-medium text-foreground">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

function PieTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: {
    name: string;
    value: number;
    payload: { color: string; isRemainder?: boolean };
  }[];
}) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  if (entry.payload.isRemainder) return null;
  return (
    <div className="rounded-lg border bg-background px-3 py-2 shadow-md text-xs">
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2 w-2 rounded-full shrink-0"
          style={{ backgroundColor: entry.payload.color }}
        />
        <span className="text-muted-foreground">{entry.name}:</span>
        <span className="font-medium text-foreground">{entry.value}%</span>
      </div>
    </div>
  );
}

// ─── Bar List ─────────────────────────────────────────────────────────────────

function BarList({ data }: { data: { name: string; value: number; color: string }[] }) {
  const max = 100;
  return (
    <div className="w-full space-y-2">
      {data.map((item) => (
        <div key={item.name} className="flex items-center gap-2 text-xs">
          <span className="w-20 shrink-0 text-muted-foreground truncate">{item.name}</span>
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.round((item.value / max) * 100)}%`,
                backgroundColor: item.color,
              }}
            />
          </div>
          <span className="w-6 text-right font-medium tabular-nums text-foreground">
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Exported Charts ──────────────────────────────────────────────────────────

export function TrendChart({ data }: { data: VisibilityTrendPoint[] }) {
  const hasCompetitors = data.some((d) => d.competitors !== null);
  // Adaptive Y ceiling (see niceVisibilityYMax): a fixed 0–100 axis flattens
  // realistic low-single-digit visibility averages into a floor-hugging line.
  const yMax = niceVisibilityYMax(
    data.flatMap((d) => [d.score, ...(d.competitors !== null ? [d.competitors] : [])]),
  );

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[192px] text-sm text-muted-foreground">
        No trend data available yet
      </div>
    );
  }

  return (
    <ChartContainer height={192}>
      {(width) => (
        <AreaChart
          width={width}
          height={192}
          data={data}
          margin={{ top: 4, right: 4, left: -24, bottom: 0 }}
        >
          <defs>
            <linearGradient id="gradScore" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradCompetitors" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#94a3b8" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            className="fill-muted-foreground"
          />
          <YAxis
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            className="fill-muted-foreground"
            domain={[0, yMax]}
          />
          <Tooltip content={<AreaTooltip />} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
          <Area
            type="monotone"
            dataKey="score"
            name="Your Brand"
            stroke="#6366f1"
            strokeWidth={2}
            fill="url(#gradScore)"
            dot={false}
            activeDot={{ r: 4 }}
          />
          {hasCompetitors && (
            <Area
              type="monotone"
              dataKey="competitors"
              name="Avg. Competitor"
              stroke="#94a3b8"
              strokeWidth={2}
              fill="url(#gradCompetitors)"
              dot={false}
              activeDot={{ r: 4 }}
              strokeDasharray="4 4"
            />
          )}
        </AreaChart>
      )}
    </ChartContainer>
  );
}

export function PlatformChart({
  data,
}: {
  data?: { platform: string; avgScore: number; resultCount: number }[];
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  const modelSlices = data
    ? data.map((d) => ({
        name: PLATFORM_LABELS[d.platform] ?? d.platform,
        value: d.avgScore,
        color: PLATFORM_COLORS[d.platform] ?? '#94a3b8',
        isRemainder: false,
      }))
    : DEFAULT_PLATFORM_DATA.map((d) => ({ ...d, isRemainder: false }));

  const totalValue = modelSlices.reduce((s, d) => s + d.value, 0);
  const remainderValue = Math.max(totalValue * 0.25, 100 - totalValue);

  const chartData = [
    ...modelSlices,
    {
      name: '_remainder',
      value: remainderValue,
      color: 'var(--muted)',
      isRemainder: true,
    },
  ];

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <ChartContainer height={140}>
        {(width) => {
          const size = Math.min(width, 140);
          return (
            <PieChart width={width} height={140}>
              <Pie
                data={chartData}
                cx={width / 2}
                cy={70}
                innerRadius={size * 0.27}
                outerRadius={size * 0.43}
                paddingAngle={2}
                dataKey="value"
                onMouseEnter={(_, index) => {
                  if (!chartData[index].isRemainder) setHovered(chartData[index].name);
                }}
                onMouseLeave={() => setHovered(null)}
              >
                {chartData.map((entry) => (
                  <Cell
                    key={entry.name}
                    fill={entry.isRemainder ? 'hsl(var(--muted))' : entry.color}
                    opacity={
                      entry.isRemainder ? 0.4 : hovered === null || hovered === entry.name ? 1 : 0.4
                    }
                    stroke="none"
                  />
                ))}
              </Pie>
              <Tooltip content={<PieTooltip />} isAnimationActive={false} />
            </PieChart>
          );
        }}
      </ChartContainer>
      <BarList data={modelSlices} />
    </div>
  );
}

// ─── Competitor Comparison Chart ──────────────────────────────────────────────

const BRAND_COLORS = [
  '#6366f1',
  '#22c55e',
  '#f97316',
  '#8b5cf6',
  '#3b82f6',
  '#ef4444',
  '#eab308',
  '#14b8a6',
  '#f43f5e',
  '#a855f7',
];

function CompetitorTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; fill: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background px-3 py-2 shadow-md text-xs">
      <p className="font-medium text-foreground mb-1">{label}</p>
      {payload
        .filter((e) => e.value > 0)
        .map((entry) => (
          <div key={entry.name} className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: entry.fill }}
            />
            <span className="text-muted-foreground">{entry.name}:</span>
            <span className="font-medium text-foreground">{entry.value}%</span>
          </div>
        ))}
    </div>
  );
}

export function CompetitorChart({
  providerRows,
  brands,
}: {
  providerRows: ProviderComparisonRow[];
  brands: CompetitorComparisonEntry[];
}) {
  const brandNames = brands.slice(0, 5).map((b) => b.name);

  // Pull every numeric visibility value across all brands × providers and
  // pick a sensible upper bound. See niceVisibilityYMax for the rules.
  const yMax = niceVisibilityYMax(
    providerRows.flatMap((row) =>
      brandNames.map((name) => row[name]).filter((v): v is number => typeof v === 'number'),
    ),
  );

  return (
    <ChartContainer height={320}>
      {(width) => (
        <BarChart
          width={width}
          height={320}
          data={providerRows}
          margin={{ top: 8, right: 8, left: -8, bottom: 0 }}
          barGap={2}
          barCategoryGap="20%"
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
          <XAxis
            dataKey="provider"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            className="fill-muted-foreground"
          />
          <YAxis
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            className="fill-muted-foreground"
            domain={[0, yMax]}
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip content={<CompetitorTooltip />} cursor={{ fill: 'hsl(var(--muted) / 0.3)' }} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
          {brandNames.map((name, i) => (
            <Bar
              key={`${name}-${i}`}
              dataKey={name}
              fill={BRAND_COLORS[i % BRAND_COLORS.length]}
              radius={[3, 3, 0, 0]}
            />
          ))}
        </BarChart>
      )}
    </ChartContainer>
  );
}

const MAX_VISIBLE = 5;

function LeaderboardEntry({ entry, rank }: { entry: CompetitorComparisonEntry; rank: number }) {
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${
        entry.isOwnBrand ? 'border-primary/30 bg-primary/5' : ''
      }`}
    >
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">
        {rank}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{entry.name}</span>
          {entry.isOwnBrand && <span className="text-[10px] font-medium text-primary">YOU</span>}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
          <span>{entry.totalMentions} mentions</span>
          <span>{entry.totalCitations} citations</span>
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5 shrink-0">
        <span className="text-sm font-semibold tabular-nums">{entry.avgVisibilityScore}%</span>
        {entry.change !== null && entry.change !== 0 && (
          <span
            className={`text-[10px] font-medium tabular-nums ${
              entry.change > 0 ? 'text-green-500' : 'text-red-500'
            }`}
          >
            {entry.change > 0 ? '↑' : '↓'} {Math.abs(entry.change).toFixed(1)}%
          </span>
        )}
        {entry.change === 0 && (
          <span className="text-[10px] font-medium tabular-nums text-muted-foreground">— 0%</span>
        )}
      </div>
    </div>
  );
}

export function CompetitorLeaderboard({ data }: { data: CompetitorComparisonEntry[] }) {
  const [expanded, setExpanded] = useState(false);

  const needsTruncation = data.length > MAX_VISIBLE;

  const visibleEntries: { entry: CompetitorComparisonEntry; rank: number }[] = (() => {
    if (!needsTruncation || expanded) {
      return data.map((entry, i) => ({ entry, rank: i + 1 }));
    }

    const ownBrandIdx = data.findIndex((e) => e.isOwnBrand);
    const ownBrandInTop = ownBrandIdx >= 0 && ownBrandIdx < MAX_VISIBLE - 1;

    if (ownBrandInTop || ownBrandIdx < 0) {
      return data.slice(0, MAX_VISIBLE).map((entry, i) => ({ entry, rank: i + 1 }));
    }

    // Show top 4 + own brand at its actual rank
    const top = data.slice(0, MAX_VISIBLE - 1).map((entry, i) => ({ entry, rank: i + 1 }));
    top.push({ entry: data[ownBrandIdx], rank: ownBrandIdx + 1 });
    return top;
  })();

  return (
    <div className="space-y-2">
      {visibleEntries.map(({ entry, rank }, idx) => (
        <LeaderboardEntry
          key={`lb-${idx}-${rank}-${entry.isOwnBrand ? 'own' : entry.name}`}
          entry={entry}
          rank={rank}
        />
      ))}
      {needsTruncation && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full text-center text-xs font-medium text-muted-foreground hover:text-foreground py-2 transition-colors"
        >
          Show all ({data.length})
        </button>
      )}
      {expanded && (
        <button
          onClick={() => setExpanded(false)}
          className="w-full text-center text-xs font-medium text-muted-foreground hover:text-foreground py-2 transition-colors"
        >
          Show less
        </button>
      )}
    </div>
  );
}

// ─── Share of Voice Charts ───────────────────────────────────────────────────

export function ShareOfVoicePlatformChart({
  data,
  overallSov,
}: {
  data: SoVByPlatform[];
  overallSov: number;
}) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[280px] text-sm text-muted-foreground">
        No share of voice data available
      </div>
    );
  }

  const palette = [
    '#6366f1',
    '#8b5cf6',
    '#3b82f6',
    '#22c55e',
    '#f97316',
    '#f59e0b',
    '#06b6d4',
    '#ec4899',
  ];

  const chartData = data.map((d, index) => ({
    ...d,
    fill: palette[index % palette.length],
    voiceMentions: d.brandMentions + d.competitorMentions,
  }));
  const totalVoiceMentions = chartData.reduce((sum, d) => sum + d.voiceMentions, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="text-center">
        <div className="text-4xl font-bold tabular-nums">{overallSov}%</div>
        <div className="text-xs text-muted-foreground mt-0.5">Overall Share of Voice</div>
      </div>

      <ChartContainer height={200}>
        {(width) => {
          const size = Math.min(width, 220);
          return (
            <PieChart width={width} height={200}>
              <Pie
                data={chartData}
                cx={width / 2}
                cy={100}
                innerRadius={size * 0.28}
                outerRadius={size * 0.44}
                paddingAngle={2}
                dataKey="voiceMentions"
                nameKey="provider"
              >
                {chartData.map((entry) => (
                  <Cell key={entry.provider} fill={entry.fill} stroke="none" />
                ))}
              </Pie>
              <Tooltip
                isAnimationActive={false}
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const p = payload[0].payload as SoVByPlatform & {
                    fill: string;
                    voiceMentions: number;
                  };
                  const platformShare =
                    totalVoiceMentions > 0 ? (p.voiceMentions / totalVoiceMentions) * 100 : 0;
                  return (
                    <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-sm">
                      <div className="font-medium">{p.provider}</div>
                      <div className="text-muted-foreground">
                        {p.sov.toFixed(1)}% SoV · {platformShare.toFixed(1)}% of voice
                      </div>
                    </div>
                  );
                }}
              />
            </PieChart>
          );
        }}
      </ChartContainer>

      <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {chartData.map((d) => (
          <li key={d.provider} className="flex items-center gap-2 text-xs">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: d.fill }}
              aria-hidden
            />
            <span className="truncate text-foreground">{d.provider}</span>
            <span className="ml-auto tabular-nums text-muted-foreground">{d.sov.toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SoVTrendTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background px-3 py-2 shadow-md text-xs">
      <p className="font-medium text-foreground mb-1">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-medium text-foreground">{entry.value}%</span>
        </div>
      ))}
    </div>
  );
}

export function ShareOfVoiceTrendChart({ data }: { data: SoVTrendPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[280px] text-sm text-muted-foreground">
        No trend data available yet
      </div>
    );
  }

  const hasCompetitors = data.some((d) => d.competitorSov > 0);

  return (
    <ChartContainer height={280}>
      {(width) => (
        <AreaChart
          width={width}
          height={280}
          data={data}
          margin={{ top: 4, right: 4, left: -24, bottom: 0 }}
        >
          <defs>
            <linearGradient id="gradSovBrand" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradSovComp" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#94a3b8" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            className="fill-muted-foreground"
          />
          <YAxis
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            className="fill-muted-foreground"
            domain={[0, 100]}
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip content={<SoVTrendTooltip />} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
          <Area
            type="monotone"
            dataKey="brandSov"
            name="Your Brand"
            stroke="#6366f1"
            strokeWidth={2}
            fill="url(#gradSovBrand)"
            dot={false}
            activeDot={{ r: 4 }}
          />
          {hasCompetitors && (
            <Area
              type="monotone"
              dataKey="competitorSov"
              name="Competitors"
              stroke="#94a3b8"
              strokeWidth={2}
              fill="url(#gradSovComp)"
              dot={false}
              activeDot={{ r: 4 }}
              strokeDasharray="4 4"
            />
          )}
        </AreaChart>
      )}
    </ChartContainer>
  );
}
