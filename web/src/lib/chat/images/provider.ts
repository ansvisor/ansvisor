/**
 * Chat's image client (CHAT-15 §E, W4-07; owner decision 2026-11-02:
 * OpenRouter, plain fetch, no new package). One interface,
 * generateImages({ model, prompt, count, size: '1K', key }): `count`
 * requests to OpenRouter's chat completions with the image modality, at
 * most IMAGES_AT_ONCE at a time, each asking for one image and for its cost
 * (usage.cost, what OpenRouter billed in dollars). What comes back is every
 * image made, and the cost as the provider reported it, which the AI budget
 * takes as it is (budget.ts reserveImages; no markup). Calls ask for
 * providers that keep no data, as Chat's other OpenRouter calls do. Server
 * only: the key never reaches a browser.
 */

export const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** The size every image is made at (Karar 4): 1K. */
export type ImageSize = '1K';

/** How many image requests run at once. */
export const IMAGES_AT_ONCE = 4;
/** How long one image may take. */
export const IMAGE_TIMEOUT_MS = 90_000;

export interface ImageRequest {
  /** The model's OpenRouter id ("google/gemini-3.1-flash-lite-image"). */
  model: string;
  prompt: string;
  /** How many images (1–10), each its own request. */
  count: number;
  size: ImageSize;
  /** The OpenRouter key the requests run on. */
  key: string;
  /** "16:9", "1:1"…, when the model takes one. */
  aspectRatio?: string;
  signal?: AbortSignal;
}

export interface GeneratedImage {
  /** The image's bytes, base64. */
  base64: string;
  mimeType: string;
}

export interface ImageResult {
  images: GeneratedImage[];
  /**
   * What the provider said the requests cost in all, in dollars (usage.cost);
   * null when a request that may have billed said nothing, and the budget
   * then prices each image made at the model's catalog price.
   */
  costUsd: number | null;
  /** Why requests made no image: the provider's words, for a one-line notice. */
  refusals: string[];
}

interface CompletionBody {
  choices?: {
    message?: {
      content?: unknown;
      images?: { image_url?: { url?: unknown } }[];
    };
  }[];
  usage?: { cost?: unknown };
  error?: { message?: unknown };
}

const DATA_URL = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i;

/** The images of one answer, from its data URLs. */
function imagesOf(body: CompletionBody): GeneratedImage[] {
  const found: GeneratedImage[] = [];
  for (const choice of body.choices ?? []) {
    for (const image of choice.message?.images ?? []) {
      const url = image.image_url?.url;
      const match = typeof url === 'string' ? DATA_URL.exec(url) : null;
      if (match) found.push({ mimeType: match[1].toLowerCase(), base64: match[2] });
    }
  }
  return found;
}

/** One request: its images, its reported cost (null when it said none), and why none came. */
async function oneImage(
  request: ImageRequest,
): Promise<{ images: GeneratedImage[]; costUsd: number | null; refusal: string | null }> {
  const signal = request.signal
    ? AbortSignal.any([request.signal, AbortSignal.timeout(IMAGE_TIMEOUT_MS)])
    : AbortSignal.timeout(IMAGE_TIMEOUT_MS);
  const res = await fetch(OPENROUTER_CHAT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${request.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: request.model,
      messages: [{ role: 'user', content: request.prompt }],
      modalities: ['image', 'text'],
      image_config: {
        image_size: request.size,
        ...(request.aspectRatio ? { aspect_ratio: request.aspectRatio } : {}),
      },
      // What the request cost, in the answer (usage.cost).
      usage: { include: true },
      // As Chat's other OpenRouter calls: only providers that keep no data.
      provider: { data_collection: 'deny' },
    }),
    signal,
  });
  const body = (await res.json().catch(() => ({}))) as CompletionBody;
  const raw = body.usage?.cost;
  const cost =
    typeof raw === 'number' || (typeof raw === 'string' && raw.trim()) ? Number(raw) : NaN;
  const costUsd = Number.isFinite(cost) && cost >= 0 ? cost : null;
  if (!res.ok) {
    const words = typeof body.error?.message === 'string' ? body.error.message : res.statusText;
    // A refused request bills nothing, unless it says otherwise.
    return { images: [], costUsd: costUsd ?? 0, refusal: words || `HTTP ${res.status}` };
  }
  const images = imagesOf(body);
  const said = body.choices?.[0]?.message?.content;
  return {
    images,
    costUsd,
    refusal: images.length === 0 ? (typeof said === 'string' && said.trim()) || 'No image' : null,
  };
}

/**
 * Makes `count` images, IMAGES_AT_ONCE at a time; a request that fails
 * makes none and the others go on. Throws only when the signal stops it.
 */
export async function generateImages(request: ImageRequest): Promise<ImageResult> {
  const count = Math.max(1, Math.min(10, Math.floor(request.count)));
  const results: Awaited<ReturnType<typeof oneImage>>[] = [];
  let next = 0;
  const worker = async () => {
    while (next < count) {
      next += 1;
      request.signal?.throwIfAborted();
      try {
        results.push(await oneImage(request));
      } catch (err) {
        request.signal?.throwIfAborted();
        // No answer (a timeout, the network): nothing billed that it said.
        results.push({ images: [], costUsd: null, refusal: (err as Error)?.name ?? 'Failed' });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(IMAGES_AT_ONCE, count) }, worker));
  // One request that said no cost: the budget prices each image made at its catalog price.
  const unknown = results.some((r) => r.costUsd === null);
  return {
    images: results.flatMap((r) => r.images).slice(0, count),
    costUsd: unknown ? null : results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0),
    refusals: results.flatMap((r) => (r.refusal ? [r.refusal] : [])),
  };
}
