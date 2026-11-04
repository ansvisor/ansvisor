// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Content Editor's AI image options in content-images (W4-09): stored
 * under the workspace's ai-options folder as they are made, the picked one
 * moved to where an upload goes, the others dropped; only ai-options is
 * ever deleted from.
 */

const store = vi.hoisted(() => ({
  bucket: '' as string,
  upload: vi.fn(),
  move: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    storage: {
      from: (bucket: string) => {
        store.bucket = bucket;
        return {
          upload: store.upload,
          move: store.move,
          remove: store.remove,
          getPublicUrl: (path: string) => ({
            data: { publicUrl: `https://cdn.example/content-images/${path}` },
          }),
        };
      },
    },
  },
}));

const { AI_OPTION_ID, dropAiImageOptions, keepAiImageOption, storeAiImageOptions } =
  await import('./ai-image-store');

const ORG = '22222222-2222-4222-8222-222222222222';
const A = '0b6c2f2e-6a43-4c55-9f0e-3f4f1d2a7c01.jpg';
const B = '0b6c2f2e-6a43-4c55-9f0e-3f4f1d2a7c02.jpg';
const C = '0b6c2f2e-6a43-4c55-9f0e-3f4f1d2a7c03.png';
const jpeg = (bytes = 3) => ({
  base64: Buffer.alloc(bytes, 1).toString('base64'),
  mimeType: 'image/jpeg',
});

beforeEach(() => {
  store.upload.mockReset().mockResolvedValue({ data: {}, error: null });
  store.move.mockReset().mockResolvedValue({ data: {}, error: null });
  store.remove.mockReset().mockResolvedValue({ data: [], error: null });
});

describe('storing a request’s images as options', () => {
  it('puts each under the workspace’s ai-options folder, with its type, and hands back ids and addresses', async () => {
    const { stored, failed } = await storeAiImageOptions(ORG, [
      jpeg(),
      { base64: 'iVBO', mimeType: 'image/png' },
    ]);
    expect(failed).toBe(0);
    expect(store.bucket).toBe('content-images');
    expect(stored).toHaveLength(2);
    expect(stored[0].id).toMatch(AI_OPTION_ID);
    expect(stored[0].id).toMatch(/\.jpg$/);
    expect(stored[1].id).toMatch(/\.png$/);
    expect(stored[0].url).toBe(
      `https://cdn.example/content-images/${ORG}/ai-options/${stored[0].id}`,
    );
    const [path, bytes, options] = store.upload.mock.calls[0];
    expect(path).toBe(`${ORG}/ai-options/${stored[0].id}`);
    expect(Buffer.isBuffer(bytes) && bytes.length).toBe(3);
    expect(options).toEqual({ contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
  });

  it('counts what couldn’t go up, keeps the others, and never throws', async () => {
    store.upload
      .mockResolvedValueOnce({ data: null, error: { message: 'storage down' } })
      .mockRejectedValueOnce(new Error('reset'));
    const { stored, failed } = await storeAiImageOptions(ORG, [
      jpeg(),
      jpeg(),
      jpeg(),
      // A type the bucket doesn't take, and one past its 5 MB.
      { base64: 'AAA=', mimeType: 'image/svg+xml' },
      jpeg(5 * 1024 * 1024 + 1),
    ]);
    expect(stored).toHaveLength(1);
    expect(failed).toBe(4);
    expect(store.upload).toHaveBeenCalledTimes(3);
  });
});

describe('Use this image', () => {
  it('moves the picked one to where an upload goes and drops the others', async () => {
    expect(await keepAiImageOption(ORG, B, [A, B, C])).toEqual({
      url: `https://cdn.example/content-images/${ORG}/${B}`,
    });
    expect(store.move).toHaveBeenCalledWith(`${ORG}/ai-options/${B}`, `${ORG}/${B}`);
    expect(store.remove).toHaveBeenCalledWith([`${ORG}/ai-options/${A}`, `${ORG}/ai-options/${C}`]);
  });

  it('drops nothing when it couldn’t move, so the person can try again', async () => {
    store.move.mockResolvedValue({ data: null, error: { message: 'Object not found' } });
    expect(await keepAiImageOption(ORG, B, [A])).toBeNull();
    store.move.mockRejectedValue(new Error('reset'));
    expect(await keepAiImageOption(ORG, B, [A])).toBeNull();
    expect(await keepAiImageOption(ORG, '../other-org/x.jpg', [A])).toBeNull();
    expect(store.remove).not.toHaveBeenCalled();
  });
});

describe('dropping options', () => {
  it('reaches only option ids, in the workspace’s own ai-options folder', async () => {
    await dropAiImageOptions(ORG, [A, A, `../${A}`, `other-org/${B}`, 'x.jpg', C]);
    expect(store.remove).toHaveBeenCalledWith([`${ORG}/ai-options/${A}`, `${ORG}/ai-options/${C}`]);
    store.remove.mockClear();
    await dropAiImageOptions(ORG, ['not-an-option.jpg']);
    expect(store.remove).not.toHaveBeenCalled();
  });

  it('is best effort: a failure is logged, never thrown', async () => {
    store.remove.mockRejectedValue(new Error('reset'));
    await expect(dropAiImageOptions(ORG, [A])).resolves.toBeUndefined();
  });
});
