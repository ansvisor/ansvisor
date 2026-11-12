import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { AGENT_HUBS, AGENT_TAGS, AgentBackdrop, runAgent } from './agent-backdrop';

/**
 * The agent animation behind sign-up and sign-in (owner-approved,
 * 2026-11-10): a canvas that is never in the way, the owner's words from
 * en.json, nothing drawn on the page's text, one still frame with reduced
 * motion, nothing below xl, and nothing left running once it is gone.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type Call = { fn: string; args: unknown[] };

/** A 2D context that records what is drawn. */
function fakeContext(calls: Call[]) {
  const record =
    (fn: string) =>
    (...args: unknown[]) => {
      calls.push({ fn, args });
    };
  return new Proxy(
    { measureText: (text: string) => ({ width: text.length * 7 }), calls },
    {
      get(target, key: string) {
        if (key in target) return target[key as keyof typeof target];
        return record(key);
      },
      set() {
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
}

const rect = (left: number, top: number, width: number, height: number) =>
  ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
  }) as DOMRect;

/** The auth frame at 1440×900, with a card in the middle kept clear. */
function frame() {
  const wrap = document.createElement('div');
  wrap.getBoundingClientRect = () => rect(0, 0, 1440, 900);
  const card = document.createElement('div');
  card.setAttribute('data-keep-clear', 'column');
  card.getBoundingClientRect = () => rect(510, 180, 420, 560);
  wrap.appendChild(card);
  const canvas = document.createElement('canvas');
  wrap.prepend(canvas);
  document.body.appendChild(wrap);
  return { wrap, canvas, card: { x1: 510, y1: 180, x2: 930, y2: 740 } };
}

function media({ wide = true, still = false }) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('reduced-motion') ? still : wide,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

const words = {
  agent: messages.auth.agent.name,
  hubs: AGENT_HUBS.map((k) => messages.auth.agent.hubs[k]),
  tags: AGENT_TAGS.map((k) => messages.auth.agent.tags[k]),
};

let calls: Call[];
beforeEach(() => {
  calls = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => fakeContext(calls) as never,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('AgentBackdrop', () => {
  it('is a canvas behind the page that is never in the way, and nothing is drawn on the server', () => {
    const markup = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <AgentBackdrop />
      </NextIntlClientProvider>,
    );
    expect(markup).toMatch(
      /^<canvas aria-hidden="true" data-slot="agent-backdrop" class="[^"]*"><\/canvas>$/,
    );
    expect(markup).toContain('pointer-events-none');
    expect(markup).toMatch(/class="[^"]*(^| )hidden [^"]*xl:block/);
    expect(calls).toHaveLength(0);
  });

  it("carries the owner's words, from en.json", () => {
    expect(words.hubs).toEqual([
      'ChatGPT',
      'Gemini',
      'Google AI Overviews',
      'Google AI Mode',
      'Claude',
      'Bing AI Mode',
    ]);
    expect(words.tags).toEqual([
      '+1 citation',
      'mentioned',
      '#1 answer',
      'cited',
      '+1 mention',
      'top 3',
      'New traffic',
      'New demand',
      '+$ revenue',
    ]);
    expect(words.agent).toBe('Ansvisor');
  });

  it('with reduced motion, draws one still frame: the hubs, the agent, and nothing on the card', () => {
    media({ still: true });
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const { wrap, canvas, card } = frame();
    const stop = runAgent(canvas, wrap, words);

    expect(raf).not.toHaveBeenCalled();
    const frames = calls.filter((c) => c.fn === 'clearRect' && c.args[2] === 1440);
    expect(frames).toHaveLength(1);
    const texts = calls.filter((c) => c.fn === 'fillText').map((c) => c.args[0]);
    for (const hub of words.hubs) expect(texts).toContain(hub);
    expect(texts).toContain('Ansvisor');
    // No dot, hub or agent on the card (it's wiped there at the end, too).
    const onCard = calls.filter(
      (c) =>
        ['arc', 'fillText'].includes(c.fn) &&
        (c.args[c.fn === 'arc' ? 0 : 1] as number) > card.x1 - 10 &&
        (c.args[c.fn === 'arc' ? 0 : 1] as number) < card.x2 + 10 &&
        (c.args[c.fn === 'arc' ? 1 : 2] as number) > card.y1 - 10 &&
        (c.args[c.fn === 'arc' ? 1 : 2] as number) < card.y2 + 10,
    );
    expect(onCard).toHaveLength(0);
    expect(calls.at(-1)).toEqual({ fn: 'clearRect', args: [500, 170, 440, 580] });
    stop();
  });

  it('draws nothing below xl', () => {
    media({ wide: false });
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const { wrap, canvas } = frame();
    runAgent(canvas, wrap, words)();
    expect(raf).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.fn === 'arc')).toHaveLength(0);
  });

  it('animates from its own mount, follows the pointer on the page, and stops on unmount', async () => {
    media({});
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(42);
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const host = document.createElement('div');
    host.getBoundingClientRect = () => rect(0, 0, 1440, 900);
    document.body.appendChild(host);
    const add = vi.spyOn(host, 'addEventListener');
    const remove = vi.spyOn(host, 'removeEventListener');
    let root: Root;
    await act(async () => {
      root = createRoot(host);
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <AgentBackdrop />
        </NextIntlClientProvider>,
      );
    });
    expect(raf).toHaveBeenCalled();
    expect(add.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining(['pointermove', 'pointerleave']),
    );
    await act(async () => root.unmount());
    expect(cancel).toHaveBeenCalledWith(42);
    expect(remove.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining(['pointermove', 'pointerleave']),
    );
  });
});
