import type { ComponentType } from 'react';
import {
  BarChart3,
  FileBarChart,
  FileText,
  Gauge,
  Globe,
  LineChart,
  Megaphone,
  Sparkles,
  Target,
  Users,
} from 'lucide-react';

/**
 * A main menu item's icon motion (the owner's request, after Resend's
 * dashboard): hovering or focusing the item plays it once, then the icon
 * rests. Each one is a block in globals.css ("The left menu's icon motions"),
 * keyed by its name here.
 */
export type NavIconMotion =
  | 'twinkle'
  | 'pulse'
  | 'turn'
  | 'bars'
  | 'draw'
  | 'call'
  | 'write'
  | 'lift'
  | 'swing'
  | 'nudge';

type Icon = ComponentType<{ className?: string }>;

/** The one place a main item's icon is paired with its motion. */
export const NAV_ICON_MOTIONS: ReadonlyMap<Icon, NavIconMotion> = new Map<Icon, NavIconMotion>([
  [Sparkles, 'twinkle'], // Chat: the small stars twinkle as the big one turns a little.
  [Target, 'pulse'], // Action Center: one pulse through the rings, from the centre out.
  [Globe, 'turn'], // Prompts: the globe turns once.
  [BarChart3, 'bars'], // Visibility: the bars dip and grow back, one after another.
  [LineChart, 'draw'], // AI Referral Traffic: the trend line draws in.
  [Megaphone, 'call'], // Ads: the megaphone tips up.
  [FileText, 'write'], // Content: the lines write in, one after another.
  [FileBarChart, 'lift'], // Reports: the page lifts a little.
  [Gauge, 'swing'], // Site Audit: the needle swings back and settles.
  [Users, 'nudge'], // Competitors: the two people shift a little.
]);

/** A main menu item's icon, with its motion. */
export function NavIcon({ icon: Icon }: { icon: Icon }) {
  return <Icon className="h-4 w-4 shrink-0" data-nav-motion={NAV_ICON_MOTIONS.get(Icon)} />;
}
