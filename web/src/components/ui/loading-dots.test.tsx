import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LoadingDots } from './loading-dots';

/** The dots say nothing to a screen reader, and stay visible with reduced motion. */

describe('LoadingDots', () => {
  it('is hidden from screen readers and stays visible without motion', () => {
    const html = renderToStaticMarkup(<LoadingDots />);
    const root = new DOMParser().parseFromString(html, 'text/html').body.firstElementChild!;
    expect(root.getAttribute('aria-hidden')).toBe('true');
    const dots = [...root.children];
    expect(dots).toHaveLength(3);
    for (const dot of dots) {
      expect(dot.className).toContain('motion-reduce:animate-none');
      expect(dot.className).toContain('motion-reduce:opacity-60');
    }
  });
});
