import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Upload an image instead of pasting its address (00272). */

const upload = vi.fn();
let user: { id: string } | null;
let profile: { organization_id: string } | null;
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: profile, error: null }),
      };
      return chain;
    },
    storage: {
      from: (bucket: string) => ({
        upload: (...args: unknown[]) => upload(bucket, ...args),
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://store.example/public/${bucket}/${path}` },
        }),
      }),
    },
  }),
}));

const { IMAGE_UPLOAD_MAX_BYTES, imageUploadProblem, uploadContentImage } =
  await import('./image-upload');

const file = (type: string, size = 1000) => new File([new Uint8Array(size)], 'shot', { type });

beforeEach(() => {
  user = { id: 'u1' };
  profile = { organization_id: 'org-1' };
  upload.mockReset().mockResolvedValue({ data: {}, error: null });
});

describe('uploadContentImage', () => {
  it("puts the image in its organization's folder under a new name, and gives its address", async () => {
    const result = await uploadContentImage(file('image/png'));
    const [bucket, path, , options] = upload.mock.calls[0];
    expect(bucket).toBe('content-images');
    expect(path).toMatch(/^org-1\/[0-9a-f-]{36}\.png$/);
    expect(options).toMatchObject({ contentType: 'image/png', upsert: false });
    expect(result).toEqual({ url: `https://store.example/public/content-images/${path}` });
  });

  it('names the file without randomUUID too (a self-host on plain http)', async () => {
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      await uploadContentImage(file('image/webp'));
      expect(upload.mock.calls[0][1]).toMatch(/^org-1\/[0-9a-f]{32}\.webp$/);
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true });
    }
  });

  it('refuses a file of another type or over 5 MB before sending it', async () => {
    expect(imageUploadProblem(file('image/svg+xml'))).toBe('type');
    expect(imageUploadProblem(file('image/jpeg', IMAGE_UPLOAD_MAX_BYTES + 1))).toBe('size');
    expect(await uploadContentImage(file('application/pdf'))).toEqual({ error: 'type' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('says it failed with no session or organization, or when the upload does', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    user = null;
    expect(await uploadContentImage(file('image/jpeg'))).toEqual({ error: 'failed' });
    user = { id: 'u1' };
    profile = null;
    expect(await uploadContentImage(file('image/jpeg'))).toEqual({ error: 'failed' });
    profile = { organization_id: 'org-1' };
    upload.mockResolvedValue({
      data: null,
      error: { message: 'new row violates row-level security' },
    });
    expect(await uploadContentImage(file('image/jpeg'))).toEqual({ error: 'failed' });
    error.mockRestore();
  });
});
