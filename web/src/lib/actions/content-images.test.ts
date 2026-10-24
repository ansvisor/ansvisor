import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Who may upload an image and how much (00272): the app's gate, not the bucket's. */

let user: { id: string } | null;
let profile: { organization_id: string } | null;
let org: { subscription_status: string } | null;
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: table === 'profiles' ? profile : org, error: null }),
      };
      return chain;
    },
  }),
}));
const list = vi.fn();
const createSignedUploadUrl = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    storage: {
      from: (bucket: string) => ({
        list: (...args: unknown[]) => list(bucket, ...args),
        createSignedUploadUrl: (...args: unknown[]) => createSignedUploadUrl(bucket, ...args),
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://store.example/public/${bucket}/${path}` },
        }),
      }),
    },
  },
}));
let cloud: boolean;
vi.mock('@/config/plans', () => ({
  isCloud: () => cloud,
  isSubscriptionActive: (status: string | null | undefined) =>
    status === 'active' || status === 'trialing',
}));

const { prepareImageUpload } = await import('./content-images');
const { IMAGE_UPLOADS_PER_DAY } = await import('@/lib/content/image-upload-types');

/** Objects in the folder, the newest first, each `hoursAgo` old. */
const uploaded = (...hoursAgo: number[]) =>
  hoursAgo.map((h, i) => ({
    name: `${i}.png`,
    created_at: new Date(Date.now() - h * 3_600_000).toISOString(),
  }));

beforeEach(() => {
  user = { id: 'u1' };
  profile = { organization_id: 'org-1' };
  org = { subscription_status: 'active' };
  cloud = true;
  list.mockReset().mockResolvedValue({ data: [], error: null });
  createSignedUploadUrl.mockReset().mockImplementation(async (_bucket: string, path: string) => ({
    data: { path, token: 'tok', signedUrl: 'https://store.example/sign' },
    error: null,
  }));
});

describe('prepareImageUpload', () => {
  it("names the image in its organization's folder, and gives a one-time address for it", async () => {
    const ticket = await prepareImageUpload('image/webp');
    expect(ticket).toEqual({
      path: expect.stringMatching(/^org-1\/[0-9a-f-]{36}\.webp$/),
      token: 'tok',
      url: expect.stringMatching(/^https:\/\/store\.example\/public\/content-images\/org-1\//),
    });
    expect(createSignedUploadUrl).toHaveBeenCalledWith(
      'content-images',
      (ticket as { path: string }).path,
    );
  });

  it('takes only the bucket’s types', async () => {
    expect(await prepareImageUpload('image/svg+xml')).toEqual({ error: 'type' });
    expect(await prepareImageUpload('constructor')).toEqual({ error: 'type' });
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('needs an active or trialing subscription on the cloud', async () => {
    org = { subscription_status: 'canceled' };
    expect(await prepareImageUpload('image/png')).toEqual({ error: 'plan' });
    org = { subscription_status: 'trialing' };
    expect(await prepareImageUpload('image/png')).toMatchObject({ token: 'tok' });
  });

  it('stops at the day’s uploads on the cloud, counting the last 24 hours', async () => {
    list.mockResolvedValueOnce({
      data: uploaded(...Array.from({ length: IMAGE_UPLOADS_PER_DAY }, () => 1)),
      error: null,
    });
    expect(await prepareImageUpload('image/png')).toEqual({ error: 'limit' });
    // One of them older than a day: room for one more.
    list.mockResolvedValueOnce({
      data: uploaded(...Array.from({ length: IMAGE_UPLOADS_PER_DAY - 1 }, () => 1), 25),
      error: null,
    });
    expect(await prepareImageUpload('image/png')).toMatchObject({ token: 'tok' });
    expect(list).toHaveBeenLastCalledWith('content-images', 'org-1', {
      limit: IMAGE_UPLOADS_PER_DAY,
      sortBy: { column: 'created_at', order: 'desc' },
    });
  });

  it('has no limits on a self-host', async () => {
    cloud = false;
    org = null;
    expect(await prepareImageUpload('image/png')).toMatchObject({ token: 'tok' });
    expect(list).not.toHaveBeenCalled();
  });

  it('fails with no session or organization, or when storage does', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    user = null;
    expect(await prepareImageUpload('image/png')).toEqual({ error: 'failed' });
    user = { id: 'u1' };
    profile = null;
    expect(await prepareImageUpload('image/png')).toEqual({ error: 'failed' });
    profile = { organization_id: 'org-1' };
    list.mockResolvedValueOnce({ data: null, error: { message: 'down' } });
    expect(await prepareImageUpload('image/png')).toEqual({ error: 'failed' });
    createSignedUploadUrl.mockResolvedValueOnce({ data: null, error: { message: 'down' } });
    expect(await prepareImageUpload('image/png')).toEqual({ error: 'failed' });
    error.mockRestore();
  });
});
