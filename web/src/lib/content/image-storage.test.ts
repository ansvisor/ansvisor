// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Content images count toward the workspace's storage (00490): Chat's files
 * and the images against the plan and storage packs. The meter's toll comes
 * from readChatStorage; a read that fails lets an image go on, as before.
 */

const fakes = vi.hoisted(() => ({
  org: {} as Record<string, unknown>,
  chatBytes: 0,
  images: { data: 0 as number | null, error: null as { message: string } | null },
  grants: [] as { bytes: number }[],
  read: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const answer = () =>
        table === 'organizations'
          ? { data: fakes.org, error: null }
          : table === 'chat_storage_usage'
            ? { data: { bytes_used: fakes.chatBytes, file_count: 3 }, error: null }
            : { data: fakes.grants, error: null };
      const chain = {
        select: () => chain,
        eq: () => chain,
        gt: async () => answer(),
        maybeSingle: async () => answer(),
      };
      return chain;
    },
    rpc: vi.fn(async () => fakes.images),
  },
}));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const { readChatStorage } = await import('@/lib/chat/file-output');
const { imageStorageFits } = await import('./image-storage');

const MB = 1024 * 1024;

beforeEach(() => {
  vi.clearAllMocks();
  // The managed cloud: a self-host has no storage cap.
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  fakes.org = { plan: 'growth', subscription_status: 'active' };
  fakes.chatBytes = 300 * MB;
  fakes.images = { data: 200 * MB, error: null };
  fakes.grants = [];
});

afterEach(() => vi.unstubAllEnvs());

describe('the workspace’s storage', () => {
  it('counts Chat’s files and the content images, read for its organization', async () => {
    const storage = await readChatStorage('org-1');
    expect(storage).toMatchObject({ usedBytes: 500 * MB, fileCount: 3 });
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('content_images_bytes', {
      p_organization_id: 'org-1',
    });
  });

  it('counts Chat’s files alone when the images can’t be read, and says so in the log', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    fakes.images = { data: null, error: { message: 'statement timeout' } };
    expect((await readChatStorage('org-1')).usedBytes).toBe(300 * MB);
    expect(error).toHaveBeenCalledWith(
      '[chat/files] could not read the content images storage:',
      'statement timeout',
    );
    error.mockRestore();
  });
});

describe('room for an image', () => {
  it('fits while the files and images leave room under the plan and its packs', async () => {
    // Growth keeps 25 GB: 500 MB used leaves room for a 5 MB upload.
    expect(await imageStorageFits('org-1', 5 * MB)).toBe(true);
    fakes.images = { data: 25 * 1024 * MB - 300 * MB, error: null };
    expect(await imageStorageFits('org-1', 5 * MB)).toBe(false);
    // A storage pack makes room again.
    fakes.grants = [{ bytes: 10 * 1024 * MB }];
    expect(await imageStorageFits('org-1', 5 * MB)).toBe(true);
    // A self-host keeps no cap.
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    fakes.grants = [];
    expect(await imageStorageFits('org-1', 5 * MB)).toBe(true);
  });

  it('lets the image go on when the storage can’t be read, and logs it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    fakes.org = null as unknown as Record<string, unknown>;
    vi.spyOn(supabaseAdmin, 'from').mockImplementationOnce(() => {
      throw new Error('down');
    });
    expect(await imageStorageFits('org-1', 5 * MB)).toBe(true);
    expect(error).toHaveBeenCalledWith(
      '[content/images] could not read the workspace storage:',
      expect.any(Error),
    );
    error.mockRestore();
  });
});
