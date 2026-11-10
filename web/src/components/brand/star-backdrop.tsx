import type { CSSProperties } from 'react';
import { seededRandom } from '@/lib/seeded-random';
import { cn } from '@/lib/utils';

/**
 * The starfield of the landing page's top bar, behind the screens a new
 * person sees before the product (owner-approved, 2026-11-10: Forgot and
 * Reset password, onboarding and the welcome page; sign-up and sign-in have
 * the agent animation instead, components/auth/agent-backdrop): many tiny
 * round dots and a few four-point sparkles, white on the dark theme and
 * grey on the light one. A third of the dots and every sparkle twinkle
 * slowly; the rest stay still, and with reduced motion all of them do.
 *
 * Stars never sit on text, a form or the onboarding window: they are only
 * drawn in zones beside the page's centre column (and, in the auth frame,
 * the empty middle of the header), measured from the layouts they go
 * behind. Below xl (1280px) those zones get too narrow, so the whole layer
 * is hidden. Decoration only: hidden from screen readers, never in the way
 * of a click, behind the page's content, and out of the layout's flow.
 */
export type StarBackdropProps =
  | { layout: 'auth' }
  | {
      layout: 'onboarding';
      /** The wizard window's width (OnboardingFrame's `width`). */
      window: 'narrow' | 'medium' | 'wide';
    };

type Star = {
  kind: 'dot' | 'sparkle';
  /** Centre, as a percentage of the zone. */
  x: number;
  y: number;
  /** Diameter or width, px. */
  size: number;
  /** Opacity on the dark theme (the light theme dims the whole layer). */
  opacity: number;
  /** Twinkle duration and delay, s; none for a still star. */
  twinkle: { duration: number; delay: number } | null;
};

type Zone = {
  id: string;
  /** Where the zone sits, in the layer's own box. */
  place: CSSProperties;
  stars: Star[];
};

const round = (n: number, digits = 2) => Number(n.toFixed(digits));

/** The four-point sparkle (✦) of the landing page. */
const SPARKLE_PATH =
  'M12 0C12.9 8.2 15.8 11.1 24 12C15.8 12.9 12.9 15.8 12 24C11.1 15.8 8.2 12.9 0 12C8.2 11.1 11.1 8.2 12 0Z';

/** Sparkle sizes and opacities, in order: the first in each zone is a brighter one. */
const SPARKLES = [
  { size: 10, opacity: 0.85 },
  { size: 7, opacity: 0.45 },
  { size: 8, opacity: 0.5 },
];

/**
 * `count` stars spread evenly over a zone of about `width`×`height` px at
 * 1440×900 (a jittered grid, one star per cell), the first `sparkles` of
 * them sparkles.
 */
function scatter(
  seed: number,
  count: number,
  { width, height, sparkles = 0 }: { width: number; height: number; sparkles?: number },
): Star[] {
  const rand = seededRandom(seed);
  const cols = Math.max(1, Math.round(Math.sqrt((count * width) / height)));
  const rows = Math.ceil(count / cols);
  const cells = Array.from({ length: cols * rows }, (_, i) => i);
  // A seeded shuffle, so the empty cells of a partial grid fall anywhere.
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }

  return cells.slice(0, count).map((cell, i) => {
    const x = round((((cell % cols) + 0.15 + rand() * 0.7) / cols) * 100);
    const y = round(((Math.floor(cell / cols) + 0.15 + rand() * 0.7) / rows) * 100);
    if (i < sparkles) {
      const look = SPARKLES[i % SPARKLES.length];
      return {
        kind: 'sparkle',
        x,
        y,
        ...look,
        twinkle: { duration: round(3.5 + rand() * 2.5, 1), delay: round(-rand() * 6, 1) },
      };
    }
    const r = rand();
    return {
      kind: 'dot',
      x,
      y,
      size: r < 0.1 ? 2.5 : r < 0.5 ? 2 : 1.2,
      opacity: round(0.2 + rand() * 0.55),
      twinkle:
        rand() < 0.33 ? { duration: round(3 + rand() * 3, 1), delay: round(-rand() * 6, 1) } : null,
    };
  });
}

// ── The auth pages (AuthShell) ──────────────────────────────────────────────
// The header band is 96px, and the column holds a 420px card (with the logo
// above it): the side zones keep 300px clear either side of the centre, below
// the header. Above the column, the header's empty middle takes a few stars.

const AUTH_SIDE = { top: 96, bottom: 0, width: 'calc(50% - 300px)' };
const AUTH: Zone[] = [
  {
    id: 'left',
    place: { ...AUTH_SIDE, left: 0 },
    stars: scatter(11, 60, { width: 420, height: 804, sparkles: 3 }),
  },
  {
    id: 'right',
    place: { ...AUTH_SIDE, right: 0 },
    stars: scatter(23, 60, { width: 420, height: 804, sparkles: 3 }),
  },
  {
    id: 'header',
    place: { top: 12, height: 64, left: 'calc(50% - 280px)', width: 560 },
    stars: scatter(37, 10, { width: 560, height: 64 }),
  },
];

// ── Onboarding and the welcome page (OnboardingFrame) ───────────────────────
// The window is centred, 576px (narrow), 768px (medium) or 1024px (wide) wide,
// and as tall as its step: stars only go beside it, 20px clear of its widest
// edge, so they stay put from step to step; a narrower window shows the
// bands between. The right-hand zones stop 80px short of the bottom, clear
// of the Sign out button there.

const ONB_LEFT = { top: 0, bottom: 0 };
const ONB_RIGHT = { top: 0, bottom: 80 };
const ONB_OUTER: Zone[] = [
  {
    id: 'left',
    place: { ...ONB_LEFT, left: 0, width: 'calc(50% - 532px)' },
    stars: scatter(61, 40, { width: 188, height: 900, sparkles: 3 }),
  },
  {
    id: 'right',
    place: { ...ONB_RIGHT, right: 0, width: 'calc(50% - 532px)' },
    stars: scatter(73, 40, { width: 188, height: 820, sparkles: 3 }),
  },
];
const ONB_BESIDE_MEDIUM: Zone[] = [
  {
    id: 'left-mid',
    place: { ...ONB_LEFT, left: 'calc(50% - 532px)', width: 128 },
    stars: scatter(83, 18, { width: 128, height: 900 }),
  },
  {
    id: 'right-mid',
    place: { ...ONB_RIGHT, left: 'calc(50% + 404px)', width: 128 },
    stars: scatter(97, 18, { width: 128, height: 820 }),
  },
];
const ONB_BESIDE_NARROW: Zone[] = [
  {
    id: 'left-near',
    place: { ...ONB_LEFT, left: 'calc(50% - 404px)', width: 96 },
    stars: scatter(101, 8, { width: 96, height: 900 }),
  },
  {
    id: 'right-near',
    place: { ...ONB_RIGHT, left: 'calc(50% + 308px)', width: 96 },
    stars: scatter(113, 8, { width: 96, height: 820 }),
  },
];

/** The zones a layout draws stars in. */
export function starZones(props: StarBackdropProps): Zone[] {
  if (props.layout === 'auth') return AUTH;
  if (props.window === 'wide') return ONB_OUTER;
  if (props.window === 'medium') return [...ONB_OUTER, ...ONB_BESIDE_MEDIUM];
  return [...ONB_OUTER, ...ONB_BESIDE_MEDIUM, ...ONB_BESIDE_NARROW];
}

export function StarBackdrop(props: StarBackdropProps) {
  return (
    <div
      aria-hidden
      data-slot="star-backdrop"
      data-layout={props.layout}
      data-window={props.layout === 'onboarding' ? props.window : undefined}
      className={cn(
        // Behind the page: in the auth frame's box, or fixed (like the blurred
        // preview) under the onboarding window.
        props.layout === 'auth' ? 'absolute' : 'fixed',
        'pointer-events-none inset-0 hidden select-none overflow-hidden text-[#8a8a8a] opacity-65 xl:block dark:text-white dark:opacity-100',
      )}
    >
      {starZones(props).map((zone) => (
        <div key={zone.id} data-zone={zone.id} className="absolute" style={zone.place}>
          {zone.stars.map((star, i) => (
            <StarMark key={i} star={star} />
          ))}
        </div>
      ))}
    </div>
  );
}

function StarMark({ star }: { star: Star }) {
  const style = {
    left: `${star.x}%`,
    top: `${star.y}%`,
    width: star.size,
    height: star.size,
    '--star-o': star.opacity,
    ...(star.twinkle && {
      animationDuration: `${star.twinkle.duration}s`,
      animationDelay: `${star.twinkle.delay}s`,
    }),
  } as CSSProperties;
  const className = cn(
    'absolute -translate-x-1/2 -translate-y-1/2 opacity-(--star-o)',
    star.twinkle && 'animate-star-twinkle motion-reduce:animate-none',
  );

  if (star.kind === 'sparkle')
    return (
      <svg data-star="sparkle" viewBox="0 0 24 24" className={className} style={style}>
        <path d={SPARKLE_PATH} fill="currentColor" />
      </svg>
    );
  return (
    <span data-star="dot" className={cn(className, 'rounded-full bg-current')} style={style} />
  );
}
