'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { seededRandom } from '@/lib/seeded-random';

/**
 * The landing page's CTA animation behind sign-up and sign-in (owner-approved,
 * 2026-11-10): prompt dots, and the grey "Ansvisor" agent with its pulse ring,
 * which wanders the side gutters on its own and follows the pointer. It sends
 * green sparks to the dots near it; a dot it wins turns green and draws a
 * faint line to its AI engine, three hubs on each side, and now and then a
 * green tag floats up from it.
 *
 * Nothing sits on the page's text, form or links: AuthShell marks them
 * data-keep-clear and their boxes are measured from the real layout (again on
 * every resize). No dot, hub, label, tag or the agent goes inside them, the
 * agent hops across rather than through them, and whatever a line draws there
 * is cleared. Below xl (1280px) the gutters can't hold the hubs and labels, so
 * nothing is drawn. With reduced motion it is one still frame. It runs only
 * while the tab is shown and the canvas is on screen, and never on the server.
 */

/** The hubs' engines, in the mockup's order: even on the left, odd on the right, top to bottom. */
export const AGENT_HUBS = [
  'chatgpt',
  'gemini',
  'googleAiOverviews',
  'googleAiMode',
  'claude',
  'bingAiMode',
] as const;
/** The tags that float up from a won dot. */
export const AGENT_TAGS = [
  'citation',
  'mentioned',
  'firstAnswer',
  'cited',
  'mention',
  'topThree',
  'traffic',
  'demand',
  'revenue',
] as const;

export type AgentWords = { agent: string; hubs: string[]; tags: string[] };

export function AgentBackdrop() {
  const t = useTranslations('auth.agent');
  const ref = useRef<HTMLCanvasElement>(null);
  const words = useMemo<AgentWords>(
    () => ({
      agent: t('name'),
      hubs: AGENT_HUBS.map((key) => t(`hubs.${key}`)),
      tags: AGENT_TAGS.map((key) => t(`tags.${key}`)),
    }),
    [t],
  );

  useEffect(() => {
    const canvas = ref.current;
    const wrap = canvas?.parentElement;
    if (!canvas || !wrap) return;
    return runAgent(canvas, wrap, words);
  }, [words]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      data-slot="agent-backdrop"
      className="pointer-events-none absolute inset-0 hidden size-full xl:block"
    />
  );
}

// ── The animation ───────────────────────────────────────────────────────────

/** Width from which it is drawn (Tailwind's xl). */
export const AGENT_MIN_WIDTH = 1280;
/** Dots at 1440×900, as in the mockup; more or fewer with the page's area. */
const DOTS_AT_1440x900 = 420;
/** How far the agent reaches for dots. */
const REACH = 170;
/** Dots, hubs and their labels stay this far from text and the form. */
const DOT_PAD = 28;
/** The agent, with its ring and its name under it, stays this far. */
const AGENT_PAD = 48;
/** Nothing is drawn closer than this (a line passing by is cut here). */
const CLEAR_PAD = 10;

type Rect = { x1: number; y1: number; x2: number; y2: number };
type Node = { hx: number; hy: number; x: number; y: number; ph: number; w: number; hub: number };
type Hub = { name: string; left: boolean; x: number; y: number; p: number };
type Spark = { n: Node; sx: number; sy: number; t: number };
type Tag = { x: number; y: number; txt: string; t: number };
type Rgb = [number, number, number];

type Palette = {
  ink: Rgb;
  dot: number;
  near: number;
  green: Rgb;
  spark: string;
  hubText: Rgb;
  hubIdle: string;
  agent: string;
  agentRing: Rgb;
  agentLabel: string;
};

/** The mockup's colours: white dots, green accents, a grey agent. */
const DARK: Palette = {
  ink: [255, 255, 255],
  dot: 0.22,
  near: 0.1,
  green: [74, 222, 128],
  spark: 'rgba(134,239,172,0.95)',
  hubText: [255, 255, 255],
  hubIdle: 'rgba(255,255,255,0.35)',
  agent: '#d6d3d1',
  agentRing: [214, 211, 209],
  agentLabel: '#a8a29e',
};
/** The light theme's: the page's ink and muted text, a deeper green, a darker agent. */
const LIGHT: Palette = {
  ink: [10, 10, 10],
  dot: 0.16,
  near: 0.07,
  green: [34, 197, 94],
  spark: 'rgba(34,197,94,0.95)',
  hubText: [92, 92, 92],
  hubIdle: 'rgba(10,10,10,0.3)',
  agent: '#78716c',
  agentRing: [120, 113, 108],
  agentLabel: '#78716c',
};

const rgba = ([r, g, b]: Rgb, a: number) => `rgba(${r},${g},${b},${a.toFixed(3)})`;
const mix = (a: Rgb, b: Rgb, k: number): Rgb => [
  Math.round(a[0] + (b[0] - a[0]) * k),
  Math.round(a[1] + (b[1] - a[1]) * k),
  Math.round(a[2] + (b[2] - a[2]) * k),
];

const grow = (r: Rect, pad: number): Rect => ({
  x1: r.x1 - pad,
  y1: r.y1 - pad,
  x2: r.x2 + pad,
  y2: r.y2 + pad,
});
const inside = (r: Rect, x: number, y: number) => x > r.x1 && x < r.x2 && y > r.y1 && y < r.y2;
const overlaps = (a: Rect, b: Rect) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;

/** The box of an element's content (a centred line of text, not its whole block), in the wrapper. */
function boxOf(el: Element, origin: DOMRect): Rect | null {
  let r: DOMRect | null = null;
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    r = range.getBoundingClientRect();
  } catch {
    r = null;
  }
  if (!r || !r.width || !r.height) r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return {
    x1: r.left - origin.left,
    y1: r.top - origin.top,
    x2: r.right - origin.left,
    y2: r.bottom - origin.top,
  };
}

/**
 * Starts the animation on `canvas`, filling `wrap` (the auth frame), with
 * `wrap`'s [data-keep-clear] elements kept clear. Returns the stop.
 */
export function runAgent(canvas: HTMLCanvasElement, wrap: HTMLElement, words: AgentWords) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};

  const media = (q: string) => (typeof window.matchMedia === 'function' ? matchMedia(q) : null);
  const wideQuery = media(`(min-width: ${AGENT_MIN_WIDTH}px)`);
  const stillQuery = media('(prefers-reduced-motion: reduce)');
  const wide = () => wideQuery?.matches ?? true;
  const still = () => stillQuery?.matches ?? false;
  const dark = () => document.documentElement.classList.contains('dark');

  let W = 0;
  let H = 0;
  let font = 'Inter, Arial, sans-serif';
  let zones: Rect[] = [];
  let col = { x1: 0, x2: 0 };
  let nodes: Node[] = [];
  let hubs: Hub[] = [];
  let sparks: Spark[] = [];
  let tags: Tag[] = [];
  let ax = 0;
  let ay = 0;
  let alpha = 1;
  let hopping = false;
  let mx = 0;
  let my = 0;
  let pointer = false;
  let side = 0;
  let sideT = 0;
  let emit = 0;
  let last = 0;
  let raf = 0;
  let onScreen = true;
  let laidOut = false;
  /** Set once stopped for good (unmounted): late callbacks then do nothing. */
  let ended = false;

  const blocked = (x: number, y: number, pad: number) =>
    zones.some((z) => inside(grow(z, pad), x, y));

  /** Measures the layout and lays the dots and hubs out for it. */
  const layout = () => {
    const origin = wrap.getBoundingClientRect();
    W = origin.width;
    H = origin.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    font = getComputedStyle(wrap).fontFamily || font;

    const marked = [...wrap.querySelectorAll('[data-keep-clear]')];
    zones = marked.flatMap((el) => boxOf(el, origin) ?? []);
    const column = marked
      .filter((el) => el.getAttribute('data-keep-clear') === 'column')
      .flatMap((el) => boxOf(el, origin) ?? []);
    col = column.length
      ? {
          x1: Math.min(...column.map((r) => r.x1)) - AGENT_PAD,
          x2: Math.max(...column.map((r) => r.x2)) + AGENT_PAD,
        }
      : { x1: W / 2, x2: W / 2 };

    // The hubs where the mockup has them, moved up or down off any text; a
    // hub that finds no room is left out.
    ctx.font = `600 14px ${font}`;
    const labelBoxes: Rect[] = [];
    hubs = words.hubs.flatMap((name, i) => {
      const left = i % 2 === 0;
      const k = Math.floor(i / 2);
      const x = left ? W * (0.055 + 0.03 * k) : W * (0.945 - 0.03 * k);
      const y0 = H * (0.2 + 0.3 * k);
      const tw = ctx.measureText(name).width;
      for (const dy of [0, -16, 16, -32, 32, -48, 48, -64, 64, -96, 96]) {
        const y = y0 + dy;
        const box = left
          ? { x1: x - 14, y1: y - 14, x2: x + 18 + tw, y2: y + 14 }
          : { x1: x - 18 - tw, y1: y - 14, x2: x + 14, y2: y + 14 };
        const fits = box.x1 >= 8 && box.x2 <= W - 8 && box.y1 >= 8 && box.y2 <= H - 8;
        if (fits && !zones.some((z) => overlaps(grow(z, DOT_PAD), box))) {
          labelBoxes.push(box);
          return [{ name, left, x, y, p: 0 }];
        }
      }
      return [];
    });

    // The same dots on every load for the same layout.
    const rand = seededRandom(5);
    const count = Math.round((DOTS_AT_1440x900 * W * H) / (1440 * 900));
    nodes = [];
    for (let tries = 0; nodes.length < count && tries < count * 30; tries++) {
      const x = rand() * W;
      const y = rand() * H;
      if (blocked(x, y, DOT_PAD) || labelBoxes.some((b) => inside(grow(b, 4), x, y))) continue;
      nodes.push({ hx: x, hy: y, x, y, ph: rand() * 6.283, w: 0, hub: -1 });
    }
    for (const n of nodes) {
      let best = Infinity;
      hubs.forEach((h, j) => {
        const d = (h.x - n.hx) ** 2 + (h.y - n.hy) ** 2;
        if (d < best) {
          best = d;
          n.hub = j;
        }
      });
    }
    sparks = [];
    tags = [];
    if (!laidOut) {
      [ax, ay] = clearOf(col.x1 / 2, H / 2);
      laidOut = true;
    } else {
      [ax, ay] = clearOf(ax, ay);
    }
  };

  /** The nearest point to (x, y) the agent may stand on: outside every zone, on the page. */
  const clearOf = (x: number, y: number): [number, number] => {
    for (let pass = 0; pass < 4; pass++) {
      const hit = zones.map((z) => grow(z, AGENT_PAD)).find((z) => inside(z, x, y));
      if (!hit) break;
      // Out by the nearest edge: [how far, x, y].
      const ways: [number, number, number][] = [
        [x - hit.x1, hit.x1, y],
        [hit.x2 - x, hit.x2, y],
        [y - hit.y1, x, hit.y1],
        [hit.y2 - y, x, hit.y2],
      ];
      const out = ways.filter(([, px, py]) => px > 16 && px < W - 16 && py > 16 && py < H - 16);
      if (!out.length) break;
      [, x, y] = out.reduce((a, b) => (b[0] < a[0] ? b : a));
    }
    return [Math.min(Math.max(x, 16), W - 16), Math.min(Math.max(y, 16), H - 16)];
  };

  /** Whether the agent's straight way to (x, y) crosses a zone. */
  const crosses = (x: number, y: number) => {
    for (let i = 1; i <= 16; i++) {
      const k = i / 16;
      if (blocked(ax + (x - ax) * k, ay + (y - ay) * k, AGENT_PAD - 2)) return true;
    }
    return false;
  };

  const moveAgent = (t: number, dt: number) => {
    let tx: number;
    let ty: number;
    let ease: number;
    if (pointer) {
      [tx, ty] = clearOf(mx, my);
      ease = 0.18;
    } else {
      sideT += dt;
      if (sideT > 9000) {
        sideT = 0;
        side = 1 - side;
      }
      const cx = side === 0 ? col.x1 / 2 : (col.x2 + W) / 2;
      const span = (side === 0 ? col.x1 : W - col.x2) * 0.32;
      [tx, ty] = clearOf(cx + span * Math.sin(t / 2600), H * (0.5 + 0.34 * Math.sin(t / 1700 + 1)));
      ease = 0.03;
    }
    // Across the column it fades out, and in again on the other side.
    if (!hopping && crosses(tx, ty)) hopping = true;
    if (hopping) {
      alpha = Math.max(0, alpha - dt / 220);
      if (alpha === 0) {
        ax = tx;
        ay = ty;
        hopping = false;
      }
      return;
    }
    alpha = Math.min(1, alpha + dt / 220);
    ax += (tx - ax) * ease;
    ay += (ty - ay) * ease;
  };

  const step = (t: number, dt: number) => {
    moveAgent(t, dt);
    for (const n of nodes) {
      n.x = n.hx + Math.sin(t / 2000 + n.ph) * 3;
      n.y = n.hy + Math.cos(t / 2400 + n.ph) * 3;
      if (n.w > 0) n.w = Math.max(0, n.w - dt / 6000);
    }
    emit += dt;
    const every = pointer ? 70 : 160;
    while (emit > every) {
      emit -= every;
      if (alpha < 0.6) continue;
      const pool = nodes.filter((n) => n.w < 0.3 && (n.x - ax) ** 2 + (n.y - ay) ** 2 < REACH ** 2);
      if (pool.length)
        sparks.push({ n: pool[Math.floor(Math.random() * pool.length)], sx: ax, sy: ay, t: 0 });
    }
    sparks = sparks.filter((s) => {
      s.t += dt / 520;
      if (s.t < 1) return true;
      s.n.w = 1;
      if (hubs[s.n.hub]) hubs[s.n.hub].p = 1;
      if (Math.random() < (pointer ? 0.12 : 0.07) && tags.length < 5) addTag(s.n);
      return false;
    });
    tags = tags.filter((g) => (g.t += dt / 1600) < 1);
    for (const h of hubs) h.p = Math.max(0, h.p - dt / 900);
  };

  /** A tag over a won dot, if its whole way up stays clear of text. */
  const addTag = (n: Node) => {
    const txt = words.tags[Math.floor(Math.random() * words.tags.length)];
    ctx.font = `600 13px ${font}`;
    const w = ctx.measureText(txt).width + 20;
    const way = { x1: n.x - w / 2, y1: n.y - 46, x2: n.x + w / 2, y2: n.y + 4 };
    const fits = way.x1 >= 4 && way.x2 <= W - 4 && way.y1 >= 4;
    if (fits && !zones.some((z) => overlaps(grow(z, CLEAR_PAD + 6), way)))
      tags.push({ x: n.x, y: n.y, txt, t: 0 });
  };

  const draw = () => {
    const c = dark() ? DARK : LIGHT;
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 1;
    for (const n of nodes) {
      const h = hubs[n.hub];
      if (n.w > 0.05 && h) {
        ctx.strokeStyle = rgba(c.green, 0.22 * n.w);
        ctx.beginPath();
        ctx.moveTo(n.x, n.y);
        ctx.lineTo(h.x, h.y);
        ctx.stroke();
      }
    }
    for (const n of nodes) {
      const d = Math.hypot(n.x - ax, n.y - ay);
      if (d < REACH) {
        ctx.strokeStyle = rgba(c.ink, c.near * (1 - d / REACH) * alpha);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(n.x, n.y);
        ctx.stroke();
      }
    }
    for (const n of nodes) {
      const g = n.w;
      ctx.fillStyle = g > 0.02 ? rgba(mix(c.ink, c.green, g), 0.25 + 0.6 * g) : rgba(c.ink, c.dot);
      ctx.beginPath();
      ctx.arc(n.x, n.y, 1.6 + 1.2 * g, 0, 6.283);
      ctx.fill();
    }
    ctx.fillStyle = c.spark;
    for (const s of sparks) {
      const e = 1 - Math.pow(1 - s.t, 3);
      const x = s.sx + (s.n.x - s.sx) * e;
      const y = s.sy + (s.n.y - s.sy) * e - Math.sin(s.t * Math.PI) * 14;
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, 6.283);
      ctx.fill();
    }

    ctx.font = `600 14px ${font}`;
    ctx.textBaseline = 'middle';
    for (const h of hubs) {
      ctx.strokeStyle = rgba(c.ink, 0.18 + 0.4 * h.p);
      ctx.beginPath();
      ctx.arc(h.x, h.y, 8 + 4 * h.p, 0, 6.283);
      ctx.stroke();
      ctx.fillStyle = h.p > 0.05 ? rgba(c.green, 0.5 + 0.5 * h.p) : c.hubIdle;
      ctx.beginPath();
      ctx.arc(h.x, h.y, 3.5, 0, 6.283);
      ctx.fill();
      ctx.fillStyle = rgba(c.hubText, 0.62 + 0.38 * h.p);
      ctx.textAlign = h.left ? 'left' : 'right';
      ctx.fillText(h.name, h.x + (h.left ? 18 : -18), h.y);
    }

    ctx.globalAlpha = alpha;
    const pulse = (Date.now() % 1400) / 1400;
    ctx.strokeStyle = rgba(c.agentRing, 0.5 * (1 - pulse));
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(ax, ay, 8 + 18 * pulse, 0, 6.283);
    ctx.stroke();
    ctx.fillStyle = c.agent;
    ctx.beginPath();
    ctx.arc(ax, ay, 4, 0, 6.283);
    ctx.fill();
    ctx.font = `600 13px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = c.agentLabel;
    ctx.fillText(words.agent, ax, ay + 14);
    ctx.globalAlpha = 1;

    ctx.textBaseline = 'middle';
    for (const g of tags) {
      const a = g.t < 0.2 ? g.t / 0.2 : 1 - (g.t - 0.2) / 0.8;
      const y = g.y - 10 - g.t * 22;
      const w = ctx.measureText(g.txt).width + 20;
      ctx.fillStyle = `rgba(22,163,74,${(0.85 * a).toFixed(3)})`;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(g.x - w / 2, y - 12, w, 24, 12);
      else ctx.rect(g.x - w / 2, y - 12, w, 24);
      ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      ctx.fillText(g.txt, g.x, y + 0.5);
    }

    // Whatever crossed the text, the form or the links is wiped there.
    for (const z of zones) {
      const r = grow(z, CLEAR_PAD);
      ctx.clearRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
    }
  };

  const frame = (t: number) => {
    if (ended) return;
    const dt = last ? Math.min(t - last, 50) : 16;
    last = t;
    step(t, dt);
    draw();
    raf = requestAnimationFrame(frame);
  };

  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
  };

  /** One still frame: a fifth of the dots won, as the mockup shows it. */
  const drawStill = () => {
    nodes.forEach((n, i) => {
      n.w = i % 5 === 0 ? 0.8 : 0;
    });
    sparks = [];
    tags = [];
    alpha = 1;
    draw();
  };

  /** Runs, draws one still frame, or rests, as the page is now. */
  const sync = () => {
    if (ended) return;
    if (!wide()) {
      stop();
      return;
    }
    if (!laidOut) layout();
    if (still()) {
      stop();
      drawStill();
      return;
    }
    const run = onScreen && !document.hidden;
    if (run && !raf) raf = requestAnimationFrame(frame);
    if (!run) stop();
  };

  let relayout = 0;
  const onResize = () => {
    if (ended || relayout) return;
    relayout = requestAnimationFrame(() => {
      relayout = 0;
      if (!wide()) return sync();
      layout();
      if (still()) drawStill();
      sync();
    });
  };

  const toLocal = (e: PointerEvent): [number, number] => {
    const r = wrap.getBoundingClientRect();
    return [
      (e.clientX - r.left) * (W / (r.width || 1)),
      (e.clientY - r.top) * (H / (r.height || 1)),
    ];
  };
  const onMove = (e: PointerEvent) => {
    [mx, my] = toLocal(e);
    pointer = true;
  };
  const onLeave = () => {
    pointer = false;
  };

  wrap.addEventListener('pointermove', onMove);
  wrap.addEventListener('pointerleave', onLeave);
  document.addEventListener('visibilitychange', sync);
  wideQuery?.addEventListener?.('change', onResize);
  stillQuery?.addEventListener?.('change', sync);

  const resizing = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null;
  resizing?.observe(wrap);
  for (const el of wrap.querySelectorAll('[data-keep-clear]')) resizing?.observe(el);

  const seeing =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(([entry]) => {
          onScreen = entry?.isIntersecting ?? true;
          sync();
        })
      : null;
  seeing?.observe(canvas);

  // A still frame follows the theme when it changes.
  const theming =
    typeof MutationObserver === 'function'
      ? new MutationObserver(() => {
          if (wide() && still() && laidOut) draw();
        })
      : null;
  theming?.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

  // Hub labels are measured in the page's font, once it has loaded.
  document.fonts?.ready.then(onResize, () => {});

  sync();

  return () => {
    ended = true;
    stop();
    if (relayout) cancelAnimationFrame(relayout);
    wrap.removeEventListener('pointermove', onMove);
    wrap.removeEventListener('pointerleave', onLeave);
    document.removeEventListener('visibilitychange', sync);
    wideQuery?.removeEventListener?.('change', onResize);
    stillQuery?.removeEventListener?.('change', sync);
    resizing?.disconnect();
    seeing?.disconnect();
    theming?.disconnect();
  };
}
