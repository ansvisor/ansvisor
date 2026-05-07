"use client";

import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { useBrandStore } from "@/stores/use-brand-store";
import type { Brand } from "@/types";
import type { BrandCardSummary } from "@/lib/actions/brand";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Globe,
  MessageSquareText,
  MoreHorizontal,
  Settings,
  Sparkles,
  Tag,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface BrandCardProps {
  brand: Brand;
  summary?: BrandCardSummary;
}

const GRADIENTS = [
  "from-indigo-500/30 via-purple-500/20 to-fuchsia-500/10",
  "from-sky-500/30 via-cyan-500/20 to-emerald-500/10",
  "from-rose-500/30 via-pink-500/20 to-amber-500/10",
  "from-violet-500/30 via-indigo-500/20 to-blue-500/10",
  "from-emerald-500/30 via-teal-500/20 to-cyan-500/10",
  "from-amber-500/30 via-orange-500/20 to-rose-500/10",
  "from-fuchsia-500/30 via-purple-500/20 to-indigo-500/10",
  "from-blue-500/30 via-sky-500/20 to-teal-500/10",
];

function pickGradient(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
}

function Sparkline({ data, positive }: { data: number[]; positive: boolean }) {
  if (!data.length || data.every((v) => v === 0)) {
    return (
      <svg viewBox="0 0 100 28" className="h-7 w-full opacity-30">
        <line
          x1="0"
          y1="14"
          x2="100"
          y2="14"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="2 3"
        />
      </svg>
    );
  }
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = Math.max(max - min, 1);
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * 100;
      const y = 26 - ((v - min) / range) * 22;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const stroke = positive ? "#10b981" : "#ef4444";
  return (
    <svg viewBox="0 0 100 28" className="h-7 w-full" preserveAspectRatio="none">
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

function StatusPill({ status }: { status: BrandCardSummary["status"] }) {
  const config = {
    healthy: {
      label: "Tracking",
      color:
        "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      icon: CheckCircle2,
    },
    declining: {
      label: "Needs attention",
      color:
        "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
      icon: TrendingDown,
    },
    "no-prompts": {
      label: "No prompts yet",
      color:
        "border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
      icon: MessageSquareText,
    },
    "no-data": {
      label: "Awaiting data",
      color:
        "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
      icon: Sparkles,
    },
  } as const;
  const c = config[status];
  return (
    <Badge variant="outline" className={cn("gap-1 text-[10px]", c.color)}>
      <c.icon className="h-2.5 w-2.5" />
      {c.label}
    </Badge>
  );
}

export function BrandCard({ brand, summary }: BrandCardProps) {
  const t = useTranslations("brands");
  const router = useRouter();
  const { activeBrandId, setActiveBrand } = useBrandStore();
  const isActive = brand.id === activeBrandId;

  const initials = brand.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const primaryDomain = brand.domains.find((d) => d.isPrimary);
  const gradient = pickGradient(brand.id);

  const visibility = summary?.visibility7d ?? 0;
  const delta = summary?.visibilityDelta ?? 0;
  const mentions = summary?.mentions7d ?? 0;
  const prompts = summary?.promptCount ?? 0;
  const trafficVisits = summary?.trafficVisits7d ?? 0;
  const trend = summary?.trend ?? [];
  const status = summary?.status ?? "no-prompts";
  const trendPositive = delta >= 0;

  const handleSelectAndGo = (path: string) => {
    setActiveBrand(brand.id);
    router.push(path);
  };

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border bg-card transition-all",
        "hover:border-primary/40 hover:shadow-lg hover:-translate-y-0.5",
        isActive && "ring-2 ring-primary border-primary/60",
      )}
    >
      {/* Hero gradient backdrop */}
      <div
        className={cn(
          "relative h-28 bg-gradient-to-br px-5 pt-5",
          gradient,
        )}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(255,255,255,0.15),_transparent_60%)]" />
        <div className="relative flex items-start justify-between gap-3">
          <Avatar className="h-14 w-14 rounded-xl ring-4 ring-background shadow-md bg-zinc-50 dark:bg-zinc-100">
            <AvatarImage
              src={brand.logoUrl}
              alt={brand.name}
              className="object-contain p-1.5"
            />
            <AvatarFallback className="rounded-xl bg-background text-foreground text-base font-bold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex items-center gap-1.5">
            {isActive && (
              <Badge
                variant="secondary"
                className="gap-1 border-primary/30 bg-primary/15 text-primary text-[10px]"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                Active
              </Badge>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 bg-background/40 backdrop-blur hover:bg-background/70"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem
                  render={<Link href={`/dashboard/brands/${brand.id}/prompts`} />}
                >
                  <MessageSquareText className="h-3.5 w-3.5 mr-2" />
                  Prompts
                </DropdownMenuItem>
                <DropdownMenuItem
                  render={<Link href={`/dashboard/brands/${brand.id}/topics`} />}
                >
                  <Tag className="h-3.5 w-3.5 mr-2" />
                  Topics
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  render={<Link href={`/dashboard/brands/${brand.id}/settings`} />}
                >
                  <Settings className="h-3.5 w-3.5 mr-2" />
                  Settings
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="px-5 pt-3 pb-4 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-base leading-tight truncate">
              {brand.name}
            </h3>
            {primaryDomain && (
              <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground truncate">
                <Globe className="h-3 w-3 shrink-0" />
                {primaryDomain.domain}
              </p>
            )}
          </div>
          <StatusPill status={status} />
        </div>

        {/* Visibility hero metric */}
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Visibility · 7d
              </p>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-2xl font-bold tabular-nums">
                  {visibility}
                  <span className="text-base font-medium text-muted-foreground">
                    %
                  </span>
                </span>
                {summary && summary.visibilityDelta !== 0 && (
                  <span
                    className={cn(
                      "flex items-center gap-0.5 text-xs font-medium tabular-nums",
                      trendPositive
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-500",
                    )}
                  >
                    {trendPositive ? (
                      <TrendingUp className="h-3 w-3" />
                    ) : (
                      <TrendingDown className="h-3 w-3" />
                    )}
                    {trendPositive ? "+" : ""}
                    {delta}%
                  </span>
                )}
              </div>
            </div>
            <div className="flex-1 max-w-[100px] text-emerald-500">
              <Sparkline data={trend} positive={trendPositive} />
            </div>
          </div>
        </div>

        {/* Compact stat strip */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md border bg-card px-2 py-1.5">
            <p className="text-base font-semibold tabular-nums leading-none">
              {prompts}
            </p>
            <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Prompts
            </p>
          </div>
          <div className="rounded-md border bg-card px-2 py-1.5">
            <p className="text-base font-semibold tabular-nums leading-none">
              {mentions}
            </p>
            <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Mentions
            </p>
          </div>
          <div className="rounded-md border bg-card px-2 py-1.5">
            <p className="text-base font-semibold tabular-nums leading-none">
              {trafficVisits >= 1000
                ? `${(trafficVisits / 1000).toFixed(1)}k`
                : trafficVisits}
            </p>
            <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Visits
            </p>
          </div>
        </div>

        {/* CTA */}
        <Button
          size="sm"
          className="w-full gap-1.5"
          onClick={() => handleSelectAndGo("/dashboard/insights")}
        >
          <BarChart3 className="h-3.5 w-3.5" />
          {t("card.viewInsights")}
          <ArrowUpRight className="h-3.5 w-3.5 ml-auto" />
        </Button>
      </div>
    </div>
  );
}
