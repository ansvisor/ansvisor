// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMAGES_AT_ONCE, OPENROUTER_CHAT_URL, generateImages } from './provider';

/** Chat's image client (W4-07): one OpenRouter request an image, its cost as the provider said. */

const PNG = 'iVBORw0KGgo=';
/** An answer with its images, and its usage.cost; none with `cost` null. */
const answer = (cost: number | null = 0.0391, images = [`data:image/png;base64,${PNG}`]) =>
  Response.json({
    choices: [{ message: { content: '', images: images.map((url) => ({ image_url: { url } })) } }],
    ...(cost === null ? {} : { usage: { cost } }),
  });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => answer());
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const request = (over = {}) => ({
  model: 'google/gemini-3.1-flash-lite-image',
  prompt: 'A cover image for a post on AI visibility',
  count: 4,
  size: '1K' as const,
  key: 'sk-or-test',
  ...over,
});

describe('generateImages', () => {
  it('asks OpenRouter for each image, at 1K, with its cost, on providers that keep no data', async () => {
    const result = await generateImages(request({ aspectRatio: '16:9' }));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(OPENROUTER_CHAT_URL);
    expect(init.headers).toMatchObject({ Authorization: 'Bearer sk-or-test' });
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'google/gemini-3.1-flash-lite-image',
      messages: [{ role: 'user', content: 'A cover image for a post on AI visibility' }],
      modalities: ['image', 'text'],
      image_config: { image_size: '1K', aspect_ratio: '16:9' },
      usage: { include: true },
      provider: { data_collection: 'deny' },
    });
    expect(result.images).toEqual(
      Array.from({ length: 4 }, () => ({ mimeType: 'image/png', base64: PNG })),
    );
    // Exactly what the provider said: 4 × $0.0391.
    expect(result.costUsd).toBeCloseTo(4 * 0.0391, 12);
    expect(result.refusals).toEqual([]);
  });

  it('keeps going past a refused request, saying why, and bills it nothing', async () => {
    fetchMock
      .mockResolvedValueOnce(answer())
      .mockResolvedValueOnce(
        Response.json(
          { error: { message: 'Request blocked by the safety filter' } },
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(answer())
      .mockResolvedValueOnce(answer(0.0391, []));
    const result = await generateImages(request());
    expect(result.images).toHaveLength(2);
    expect(result.costUsd).toBeCloseTo(3 * 0.0391, 12);
    expect(result.refusals).toEqual(['Request blocked by the safety filter', 'No image']);
  });

  it('answers no cost when a request said none, so the budget prices each image', async () => {
    fetchMock.mockResolvedValueOnce(answer(null));
    const result = await generateImages(request({ count: 2 }));
    expect(result.images).toHaveLength(2);
    expect(result.costUsd).toBeNull();
  });

  it(`runs at most ${IMAGES_AT_ONCE} requests at once`, async () => {
    let open = 0;
    let most = 0;
    fetchMock.mockImplementation(async () => {
      open += 1;
      most = Math.max(most, open);
      await new Promise((resolve) => setTimeout(resolve, 5));
      open -= 1;
      return answer();
    });
    const result = await generateImages(request({ count: 7 }));
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(most).toBe(IMAGES_AT_ONCE);
    expect(result.images).toHaveLength(7);
  });

  it('stops when its signal does', async () => {
    const stop = new AbortController();
    stop.abort();
    await expect(generateImages(request({ signal: stop.signal }))).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
