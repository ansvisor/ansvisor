import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StarBackdrop, starZones, type StarBackdropProps } from './star-backdrop';
import { OnboardingFrame } from '@/components/onboarding/onboarding-frame';

/**
 * The starfield behind Forgot and Reset password, onboarding and the welcome
 * page (owner-approved, 2026-11-10): dots and a few sparkles, some twinkling,
 * never in the way, and only in zones clear of the page's column or window.
 */

const LAYOUTS: StarBackdropProps[] = [
  { layout: 'auth' },
  { layout: 'onboarding', window: 'narrow' },
  { layout: 'onboarding', window: 'medium' },
  { layout: 'onboarding', window: 'wide' },
];

function layer(props: StarBackdropProps) {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(<StarBackdrop {...props} />);
  return host.firstElementChild as HTMLElement;
}

describe('StarBackdrop', () => {
  it('is decoration only: hidden from screen readers, never clicked, nothing to focus, hidden below xl', () => {
    for (const props of LAYOUTS) {
      const el = layer(props);
      expect(el.getAttribute('aria-hidden')).toBe('true');
      expect(el.className).toContain('pointer-events-none');
      expect(el.className).toMatch(/(^| )hidden( |$)/);
      expect(el.className).toContain('xl:block');
      expect(el.querySelectorAll('a, button, input, [tabindex]')).toHaveLength(0);
    }
    expect(layer({ layout: 'auth' }).className).toMatch(/(^| )absolute /);
    expect(layer({ layout: 'onboarding', window: 'wide' }).className).toMatch(/(^| )fixed /);
  });

  it('draws 110 to 140 dots and 5 to 7 sparkles on an auth page, the same on every render', () => {
    const el = layer({ layout: 'auth' });
    const dots = el.querySelectorAll('[data-star="dot"]').length;
    const sparkles = el.querySelectorAll('[data-star="sparkle"]').length;
    expect(dots).toBeGreaterThanOrEqual(110);
    expect(dots + sparkles).toBeLessThanOrEqual(140);
    expect(sparkles).toBeGreaterThanOrEqual(5);
    expect(sparkles).toBeLessThanOrEqual(7);
    // Seeded: no Math.random, so the server's markup is the browser's.
    expect(renderToStaticMarkup(<StarBackdrop layout="auth" />)).toBe(
      renderToStaticMarkup(<StarBackdrop layout="auth" />),
    );
  });

  it('twinkles every sparkle and about a third of the dots, each stopping with reduced motion', () => {
    for (const props of LAYOUTS) {
      const el = layer(props);
      const dots = [...el.querySelectorAll('[data-star="dot"]')];
      const twinkling = dots.filter((d) =>
        d.getAttribute('class')!.includes('animate-star-twinkle'),
      );
      expect(twinkling.length / dots.length).toBeGreaterThan(0.2);
      expect(twinkling.length / dots.length).toBeLessThan(0.45);
      for (const s of el.querySelectorAll('[data-star="sparkle"]'))
        expect(s.getAttribute('class')).toContain('animate-star-twinkle');
      for (const s of el.querySelectorAll('[class*="animate-star-twinkle"]'))
        expect(s.getAttribute('class')).toContain('motion-reduce:animate-none');
    }
    const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8');
    expect(css).toContain('--animate-star-twinkle:');
    expect(css).toMatch(/@keyframes star-twinkle\b/);
  });

  it('keeps every onboarding zone 20px clear of the window, at any width from xl up', () => {
    const WINDOW = { narrow: 576, medium: 768, wide: 1024 } as const;
    // A zone's CSS edge at a viewport width: a number, or calc(50% ± Npx).
    const at = (v: string | number | undefined, vw: number) => {
      if (typeof v === 'number') return v;
      const m = v?.match(/^calc\(50% ([+-]) (\d+)px\)$/);
      if (!m) throw new Error(`unexpected ${v}`);
      return vw / 2 + (m[1] === '+' ? 1 : -1) * Number(m[2]);
    };
    for (const vw of [1280, 1440, 1920]) {
      for (const window of ['narrow', 'medium', 'wide'] as const) {
        const clear = WINDOW[window] / 2 + 20;
        for (const zone of starZones({ layout: 'onboarding', window })) {
          const { left, right, width } = zone.place;
          const w = at(width as string | number, vw);
          const x1 =
            left !== undefined ? at(left as string | number, vw) : vw - at(right as number, vw) - w;
          const x2 = x1 + w;
          expect(
            x2 <= vw / 2 - clear || x1 >= vw / 2 + clear,
            `${window} ${zone.id} at ${vw}`,
          ).toBe(true);
        }
      }
    }
  });

  it('shows more of the field beside a narrower window', () => {
    const count = (window: 'narrow' | 'medium' | 'wide') =>
      layer({ layout: 'onboarding', window }).querySelectorAll('[data-star]').length;
    expect(count('wide')).toBeLessThan(count('medium'));
    expect(count('medium')).toBeLessThan(count('narrow'));
    expect(layer({ layout: 'onboarding', window: 'wide' }).getAttribute('data-window')).toBe(
      'wide',
    );
  });
});

describe('OnboardingFrame', () => {
  it('draws the starfield above the blurred preview and before the window', () => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(
      <OnboardingFrame width="medium" preview={<p>the preview</p>}>
        <p>the step</p>
      </OnboardingFrame>,
    );
    const frame = host.firstElementChild!;
    const layers = [...frame.children];
    const stars = layers.findIndex((el) => el.getAttribute('data-slot') === 'star-backdrop');
    expect(stars).toBe(1);
    expect(layers[0].textContent).toBe('the preview');
    expect(layers[2].textContent).toBe('the step');
    expect(layers[stars].getAttribute('data-window')).toBe('medium');
  });
});

describe('where the backdrops are drawn', () => {
  const SRC = join(__dirname, '../..');
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
  const importers = (module: string) =>
    files(SRC)
      .filter((path) => readFileSync(path, 'utf8').includes(`'${module}'`))
      .map((path) => relative(SRC, path))
      .sort();

  it('only in the auth frame and the onboarding frame, which only the pages before the product use', () => {
    expect(importers('@/components/brand/star-backdrop')).toEqual([
      'components/auth/auth-shell.tsx',
      'components/onboarding/onboarding-frame.tsx',
    ]);
    expect(importers('@/components/auth/agent-backdrop')).toEqual([
      'components/auth/auth-shell.tsx',
    ]);
    for (const path of importers('@/components/auth/auth-shell'))
      expect(path).toMatch(/^(app\/\[locale\]\/\(marketing\)\/|components\/oauth\/)/);
    expect(importers('@/components/onboarding/onboarding-frame')).toEqual([
      'app/[locale]/(onboarding)/dashboard/onboarding/page.tsx',
      'app/[locale]/(onboarding)/dashboard/welcome/page.tsx',
    ]);
  });
});
