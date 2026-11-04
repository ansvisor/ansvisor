import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';

/**
 * Generate with AI (CHAT-25 §9, W4-09): the description from the page's
 * title, the image models with how fast they use the AI limit, the options
 * to pick from by address, and Use this image, which keeps the picked one
 * on the server (no second upload); the others are dropped then, on
 * Regenerate and when the panel closes.
 */

const { AiImagePanel } = await import('./_ai-image-panel');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const DRAFT = '44444444-4444-4444-8444-444444444444';
const LITE = 'google/gemini-3.1-flash-lite-image';
const PRO = 'google/gemini-3-pro-image';
const MODELS = [
  {
    id: LITE,
    label: 'Nano Banana 2 Lite',
    multiplier: '1x',
    sharePercent: 0.15,
    recommended: true,
  },
  { id: PRO, label: 'Nano Banana Pro', multiplier: '4x', sharePercent: 0.62, recommended: false },
];
// Options as the server stored them: ids and addresses, never the images' bytes.
const option = (n: number) => ({
  id: `0b6c2f2e-6a43-4c55-9f0e-3f4f1d2a7c0${n}.jpg`,
  url: `https://cdn.example/content-images/org-1/ai-options/0b6c2f2e-6a43-4c55-9f0e-3f4f1d2a7c0${n}.jpg`,
});
const [ONE, TWO, THREE, FOUR] = [1, 2, 3, 4].map(option);
const KEPT = 'https://cdn.example/content-images/org-1/kept.jpg';

let container: HTMLElement;
let root: Root;
let posted: Record<string, unknown>[];
let settled: { body: Record<string, unknown>; keepalive: boolean }[];
let generateAnswer: { status: number; body: unknown };
let keepAnswer: { status: number; body: unknown };
const onUse = vi.fn();

beforeEach(() => {
  posted = [];
  settled = [];
  generateAnswer = { status: 200, body: { ok: true, images: [ONE, TWO], failed: 0 } };
  keepAnswer = { status: 200, body: { ok: true, url: KEPT } };
  onUse.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/images/options')) {
        const body = JSON.parse(String(init?.body));
        settled.push({ body, keepalive: init?.keepalive === true });
        return body.keep
          ? new Response(JSON.stringify(keepAnswer.body), { status: keepAnswer.status })
          : new Response(JSON.stringify({ ok: true }));
      }
      if (init?.method === 'POST') {
        posted.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify(generateAnswer.body), { status: generateAnswer.status });
      }
      return new Response(JSON.stringify({ ok: true, models: MODELS, ownKey: false }));
    }),
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  unmount();
  container.remove();
  vi.unstubAllGlobals();
});

let mounted = false;
function unmount() {
  if (!mounted) return;
  act(() => root.unmount());
  mounted = false;
}

async function render() {
  mounted = true;
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <AiImagePanel draftId={DRAFT} title="GEO strategies for 2026" onUse={onUse} />
      </NextIntlClientProvider>,
    );
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
const $ = <T extends Element = HTMLElement>(selector: string) =>
  container.querySelector<T>(selector)!;
async function click(selector: string) {
  await act(async () => $<HTMLButtonElement>(selector).click());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

describe('AiImagePanel', () => {
  it('starts from the page’s title, the recommended model and two options, with their share', async () => {
    await render();
    expect($<HTMLTextAreaElement>('#ai-image-prompt').value).toBe(
      'A cover image about GEO strategies for 2026',
    );
    expect($('[data-model="' + LITE + '"]').getAttribute('aria-checked')).toBe('true');
    expect(container.textContent).toContain('1x · about 0.15% of your monthly AI limit per image');
    expect(container.textContent).toContain('4x · about 0.62% of your monthly AI limit per image');
    expect(container.textContent).toContain('Recommended');
    expect($('[data-action="ai-image.generate"]').textContent).toContain('Generate 2 images');
    // Two Lite images: about 0.3% of the limit; never a dollar amount.
    expect(container.textContent).toContain('About 0.3% of your monthly AI limit');
    expect(container.textContent).not.toMatch(/\$/);
  });

  it('asks for the picked style, shape, model and options, then shows them to pick from', async () => {
    await render();
    await click('[data-style="illustration"]');
    await click('[data-ratio="1:1"]');
    await click(`[data-model="${PRO}"]`);
    await click('[data-count="3"]');
    await click('[data-action="ai-image.generate"]');
    expect(posted).toEqual([
      {
        prompt: 'A cover image about GEO strategies for 2026',
        style: 'illustration',
        aspectRatio: '1:1',
        model: PRO,
        count: 3,
      },
    ]);
    expect(container.querySelectorAll('[data-option]')).toHaveLength(2);
    expect($('[data-option="1"]').getAttribute('aria-checked')).toBe('true');
    expect($<HTMLInputElement>('#ai-image-alt').value).toBe(
      'A cover image about GEO strategies for 2026',
    );
    expect($('[data-action="ai-image.generate"]').textContent).toContain('Regenerate');
  });

  it('shows the options by their addresses', async () => {
    await render();
    await click('[data-action="ai-image.generate"]');
    const shown = [...container.querySelectorAll<HTMLImageElement>('[data-option] img')].map(
      (img) => img.getAttribute('src'),
    );
    expect(shown).toEqual([ONE.url, TWO.url]);
  });

  it('keeps the picked one on the server, drops the others, and hands back its address with its alt text', async () => {
    await render();
    await click('[data-action="ai-image.generate"]');
    await click('[data-option="2"]');
    await click('[data-action="ai-image.use"]');
    expect(settled).toEqual([{ body: { keep: TWO.id, drop: [ONE.id] }, keepalive: false }]);
    expect(onUse).toHaveBeenCalledWith({
      src: KEPT,
      alt: 'A cover image about GEO strategies for 2026',
    });
    // Nothing is left to drop when the dialog closes.
    unmount();
    expect(settled).toHaveLength(1);
  });

  it('drops the earlier set once Regenerate’s is in, and what is left when the panel closes', async () => {
    await render();
    await click('[data-action="ai-image.generate"]');
    // A Regenerate that fails leaves the earlier set to use.
    generateAnswer = { status: 503, body: { ok: false, code: 'failed' } };
    await click('[data-action="ai-image.generate"]');
    expect(settled).toEqual([]);
    expect(container.querySelectorAll('[data-option]')).toHaveLength(2);

    generateAnswer = { status: 200, body: { ok: true, images: [THREE, FOUR], failed: 0 } };
    await click('[data-action="ai-image.generate"]');
    expect(settled).toEqual([{ body: { drop: [ONE.id, TWO.id] }, keepalive: true }]);
    unmount();
    expect(settled.at(-1)).toEqual({ body: { drop: [THREE.id, FOUR.id] }, keepalive: true });
  });

  it('says how many were made but couldn’t be saved, and offers the others', async () => {
    generateAnswer = { status: 200, body: { ok: true, images: [ONE], failed: 1 } };
    await render();
    await click('[data-action="ai-image.generate"]');
    expect(container.querySelectorAll('[data-option]')).toHaveLength(1);
    expect($('[data-slot="ai-image-unsaved"]').textContent).toBe(
      "1 more image was made but couldn't be saved; it still counts toward your AI limit.",
    );
    generateAnswer = { status: 502, body: { ok: false, code: 'not_saved', made: 3 } };
    await click('[data-action="ai-image.generate"]');
    expect($('[role="alert"]').textContent).toBe(
      "The 3 images were made, and count toward your AI limit, but couldn't be saved. Try again.",
    );
  });

  it('says why no image came, and when the picked one couldn’t be added', async () => {
    await render();
    generateAnswer = { status: 429, body: { ok: false, code: 'ai_limit', trial: false } };
    await click('[data-count="3"]');
    await click('[data-action="ai-image.generate"]');
    // What the limit left doesn't cover the options asked for: fewer may still fit.
    expect($('[role="alert"]').textContent).toBe(
      "What's left of your monthly AI limit doesn't cover 3 images, so none was made.",
    );
    generateAnswer = { status: 422, body: { ok: false, code: 'refused', why: 'Blocked.' } };
    await click('[data-action="ai-image.generate"]');
    expect($('[role="alert"]').textContent).toContain('Blocked.');

    generateAnswer = { status: 200, body: { ok: true, images: [ONE], failed: 0 } };
    await click('[data-action="ai-image.generate"]');
    keepAnswer = { status: 503, body: { ok: false, code: 'failed' } };
    await click('[data-action="ai-image.use"]');
    expect(onUse).not.toHaveBeenCalled();
    expect($('[role="alert"]').textContent).toBe("Couldn't add the image. Try again.");
    // Not kept: it is still dropped when the panel closes.
    unmount();
    expect(settled.at(-1)).toEqual({ body: { drop: [ONE.id] }, keepalive: true });
  });
});
