import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';

/**
 * Generate with AI (CHAT-25 §9, W4-09): the description from the page's
 * title, the image models with how fast they use the AI limit, the options
 * to pick from, and Use this image, which uploads the picked one.
 */

const upload = vi.hoisted(() => ({ uploadContentImage: vi.fn() }));
vi.mock('@/lib/content/image-upload', () => upload);

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
// A 1x1 pixel, as the model would send one.
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

let container: HTMLElement;
let root: Root;
let posted: Record<string, unknown>[];
let generateAnswer: { status: number; body: unknown };
const onUse = vi.fn();

beforeEach(() => {
  posted = [];
  generateAnswer = {
    status: 200,
    body: { ok: true, images: [{ dataUrl: PIXEL }, { dataUrl: PIXEL }] },
  };
  onUse.mockReset();
  upload.uploadContentImage.mockReset().mockResolvedValue({ url: 'https://cdn.example/up.png' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('data:'))
        return new Response(new Blob([new Uint8Array([1])], { type: 'image/png' }));
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
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render() {
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

  it('uploads the picked one as an upload is, and hands it back with its alt text', async () => {
    await render();
    await click('[data-action="ai-image.generate"]');
    await click('[data-option="2"]');
    await click('[data-action="ai-image.use"]');
    expect(upload.uploadContentImage).toHaveBeenCalledOnce();
    const file = upload.uploadContentImage.mock.calls[0][0] as File;
    expect(file.name).toBe('ai-image.png');
    expect(onUse).toHaveBeenCalledWith({
      src: 'https://cdn.example/up.png',
      alt: 'A cover image about GEO strategies for 2026',
    });
  });

  it('says why no image came, and why an upload failed', async () => {
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

    generateAnswer = { status: 200, body: { ok: true, images: [{ dataUrl: PIXEL }] } };
    await click('[data-action="ai-image.generate"]');
    upload.uploadContentImage.mockResolvedValue({ error: 'limit' });
    await click('[data-action="ai-image.use"]');
    expect(onUse).not.toHaveBeenCalled();
    expect($('[role="alert"]').textContent).toBe(
      (messages as { content: { imageUpload: { errors: Record<string, string> } } }).content
        .imageUpload.errors.limit,
    );
  });
});
