import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import messages from '../../../../../../../messages/en.json';
import { TrendWindowNote } from './_charts';

/**
 * The visibility trend tooltip's window note (#2371): each point is the
 * rolling window ENDING on its day, with the window's answer count, so a
 * point can't be read as a standalone daily score. All time has no fixed
 * window and says so instead.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const note = (windowDays: number | null, answers: number) => {
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <TrendWindowNote windowDays={windowDays} answers={answers} dateLabel="Oct 14" />
      </NextIntlClientProvider>,
    ),
  );
  return container.textContent ?? '';
};

describe('TrendWindowNote', () => {
  it('names the rolling window ending on the day, with its answer count', () => {
    expect(note(30, 49)).toBe('Rolling 30-day window ending Oct 14 · 49 answers');
  });

  it('pluralizes a single answer', () => {
    expect(note(7, 1)).toBe('Rolling 7-day window ending Oct 14 · 1 answer');
  });

  it('All time has no rolling window: the point covers everything up to the day', () => {
    expect(note(null, 1200)).toBe('All answers up to Oct 14 · 1,200 answers');
  });
});
