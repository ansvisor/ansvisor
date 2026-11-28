import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { PriorityConfidence } from '@/lib/action-center/priority';
import { LowConfidenceTag } from './low-confidence-tag';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function render(confidence: PriorityConfidence | null, onRow = vi.fn()) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <div onClick={onRow}>
          <LowConfidenceTag confidence={confidence} />
        </div>
      </NextIntlClientProvider>,
    );
  });
}

const low = (over: Partial<PriorityConfidence> = {}): PriorityConfidence => ({
  level: 'low',
  score: 0.3,
  kinds: 1,
  sources: 1,
  ...over,
});

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('LowConfidenceTag (AC-26)', () => {
  it('tags a low-confidence priority and says why, without opening the row', () => {
    const onRow = vi.fn();
    render(low(), onRow);
    const tag = container.querySelector('button')!;
    expect(tag.textContent).toBe('Single source');
    expect(tag.getAttribute('aria-label')).toBe(
      'Single source: Based on one kind of finding from one source. Google Analytics, Search Console or a site audit can add a second kind of evidence. This is one part of the score; impact and demand still rank it.',
    );
    act(() => tag.click());
    expect(onRow).not.toHaveBeenCalled();
  });

  it('says an action sent by a person was rated from what it was sent with', () => {
    render(low({ kinds: 0, sources: 0 }));
    expect(container.querySelector('button')!.getAttribute('aria-label')).toBe(
      'Single source: Rated from what it was sent with, not from detected findings.',
    );
  });

  it('shows nothing at medium or high confidence, or with none kept', () => {
    render(low({ level: 'medium', score: 0.5 }));
    expect(container.textContent).toBe('');
    render(low({ level: 'high', score: 0.9 }));
    expect(container.textContent).toBe('');
    render(null);
    expect(container.textContent).toBe('');
  });
});
