'use client';

import { useRef, useState, useEffect } from 'react';
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
} from 'recharts';
import type { TrafficTrendPoint } from '@/lib/actions/traffic';

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

// ─── Platform colors ─────────────────────────────────────────────────────────
//
// Keys must stay in sync with the detection host list in the tracking snippet
// (`server/src/public/t.js`): every platform t.js can resolve and store needs a
// label + color here, otherwise it renders as a raw hostname. `unknown` is kept
// only for historical rows that predate #288 (null source_platform); new visits
// always carry a concrete platform.

const PLATFORM_COLORS: Record<string, string> = {
  'chatgpt.com': '#6366f1',
  'chat.openai.com': '#6366f1',
  'search.chatgpt.com': '#6366f1',
  'perplexity.ai': '#8b5cf6',
  'claude.ai': '#c4b5fd',
  'gemini.google.com': '#a78bfa',
  'copilot.microsoft.com': '#ddd6fe',
  'you.com': '#818cf8',
  'phind.com': '#a5b4fc',
  'meta.ai': '#7c3aed',
  'poe.com': '#e9d5ff',
  'labs.google': '#b794f6',
  'bing.com': '#67c5d6',
  unknown: '#94a3b8',
};

const PLATFORM_NAMES: Record<string, string> = {
  'chatgpt.com': 'ChatGPT',
  'chat.openai.com': 'ChatGPT',
  'search.chatgpt.com': 'ChatGPT',
  'perplexity.ai': 'Perplexity',
  'claude.ai': 'Claude',
  'gemini.google.com': 'Gemini',
  'copilot.microsoft.com': 'Copilot',
  'you.com': 'You.com',
  'phind.com': 'Phind',
  'meta.ai': 'Meta AI',
  'poe.com': 'Poe',
  'labs.google': 'Google Labs',
  'bing.com': 'Bing',
  unknown: 'Unknown',
};

function getColor(platform: string): string {
  return PLATFORM_COLORS[platform] ?? '#94a3b8';
}

export function getPlatformName(platform: string): string {
  return PLATFORM_NAMES[platform] ?? platform;
}

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
          <span className="text-muted-foreground">{getPlatformName(entry.name)}:</span>
          <span className="font-medium text-foreground">{entry.value.toLocaleString()}</span>
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
  payload?: { name: string; value: number; payload: { color: string } }[];
}) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
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
  const max = Math.max(...data.map((d) => d.value), 1);
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
          <span className="w-8 text-right font-medium tabular-nums text-foreground">
            {item.value}%
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Exported Charts ──────────────────────────────────────────────────────────

export function ReferralTrendChart({ data }: { data: TrafficTrendPoint[] }) {
  if (!data.length) return null;

  // Extract platform keys (everything except 'date')
  const platformKeys = Object.keys(data[0]).filter((k) => k !== 'date');

  return (
    <ChartContainer height={220}>
      {(width) => (
        <AreaChart
          width={width}
          height={220}
          data={data}
          margin={{ top: 4, right: 4, left: -24, bottom: 0 }}
        >
          <defs>
            {platformKeys.map((key) => (
              <linearGradient key={key} id={`grad-${key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={getColor(key)} stopOpacity={0.15} />
                <stop offset="95%" stopColor={getColor(key)} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            className="fill-muted-foreground"
            tickFormatter={(v: string) => {
              const d = new Date(v);
              return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
            }}
          />
          <YAxis
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            className="fill-muted-foreground"
            allowDecimals={false}
          />
          <Tooltip content={<AreaTooltip />} />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            formatter={(value: string) => getPlatformName(value)}
          />
          {platformKeys.map((key) => (
            <Area
              key={key}
              type="monotone"
              dataKey={key}
              name={key}
              stroke={getColor(key)}
              strokeWidth={2}
              fill={`url(#grad-${key})`}
              dot={false}
              activeDot={{ r: 3 }}
            />
          ))}
        </AreaChart>
      )}
    </ChartContainer>
  );
}

export function PlatformBreakdownChart({ data }: { data: { platform: string; visits: number }[] }) {
  const [hovered, setHovered] = useState<string | null>(null);

  const total = data.reduce((s, d) => s + d.visits, 0) || 1;
  const pieData = data
    .filter((d) => d.visits > 0)
    .map((d) => ({
      name: getPlatformName(d.platform),
      value: Math.round((d.visits / total) * 100),
      color: getColor(d.platform),
    }));

  if (!pieData.length) return null;

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <ChartContainer height={140}>
        {(width) => {
          const size = Math.min(width, 140);
          return (
            <PieChart width={width} height={140}>
              <Pie
                data={pieData}
                cx={width / 2}
                cy={70}
                innerRadius={size * 0.27}
                outerRadius={size * 0.43}
                paddingAngle={2}
                dataKey="value"
                onMouseEnter={(_, index) => setHovered(pieData[index].name)}
                onMouseLeave={() => setHovered(null)}
              >
                {pieData.map((entry) => (
                  <Cell
                    key={entry.name}
                    fill={entry.color}
                    opacity={hovered === null || hovered === entry.name ? 1 : 0.4}
                  />
                ))}
              </Pie>
              <Tooltip content={<PieTooltip />} />
            </PieChart>
          );
        }}
      </ChartContainer>
      <BarList data={pieData} />
    </div>
  );
}
