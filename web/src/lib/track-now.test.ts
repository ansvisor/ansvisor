import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Track now's API calls are the brand's Manage prompts page's own: the
 * prompts with no answers yet (GET /api/tracking/unanalyzed/:brandId), and a
 * run for some of them (POST /api/tracking/analyze-new), with the person's
 * session. What they answer is told apart for the page: started, nothing to
 * start, or refused with the API's own words.
 */

const session = vi.hoisted(() => ({
  value: { access_token: 'tok' } as { access_token: string } | null,
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: session.value } }) },
  }),
}));
vi.mock('@/config/api', () => ({ BROWSER_API_BASE_URL: 'https://api.test' }));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const { readPromptsWithoutAnswers, trackPromptsNow } = await import('./track-now');

const answer = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

beforeEach(() => {
  fetchMock.mockReset();
  session.value = { access_token: 'tok' };
});

describe('readPromptsWithoutAnswers', () => {
  it('reads the brand’s prompts with no answers yet, as the brand page did', async () => {
    fetchMock.mockResolvedValue(
      answer(200, { success: true, count: 2, prompts: [{ id: 'p1' }, { id: 'p3' }] }),
    );
    expect(await readPromptsWithoutAnswers('b 1')).toEqual(['p1', 'p3']);
    expect(fetchMock).toHaveBeenCalledWith('https://api.test/api/tracking/unanalyzed/b%201', {
      headers: { Authorization: 'Bearer tok', 'ngrok-skip-browser-warning': '1' },
    });
  });

  it('says nothing (null) when it can’t read them', async () => {
    fetchMock.mockResolvedValue(answer(500, { message: 'boom' }));
    expect(await readPromptsWithoutAnswers('b1')).toBeNull();
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(await readPromptsWithoutAnswers('b1')).toBeNull();
    session.value = null;
    expect(await readPromptsWithoutAnswers('b1')).toBeNull();
  });
});

describe('trackPromptsNow', () => {
  it('starts a run for the prompts given, with the brand page’s call', async () => {
    fetchMock.mockResolvedValue(
      answer(200, {
        success: true,
        jobId: 'job-1',
        newCount: 2,
        message: 'Analyzing 2 new prompts',
      }),
    );
    expect(await trackPromptsNow('b1', ['p1', 'p3'])).toEqual({
      ok: true,
      jobId: 'job-1',
      count: 2,
    });
    expect(fetchMock).toHaveBeenCalledWith('https://api.test/api/tracking/analyze-new', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer tok',
        'ngrok-skip-browser-warning': '1',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ brandId: 'b1', promptIds: ['p1', 'p3'] }),
    });
  });

  it('starts nothing when they have answers by now', async () => {
    fetchMock.mockResolvedValue(
      answer(200, { success: true, newCount: 0, message: 'All prompts already analyzed' }),
    );
    expect(await trackPromptsNow('b1', ['p1'])).toEqual({ ok: true, jobId: null, count: 0 });
  });

  it('passes a refusal on with the API’s words and code', async () => {
    fetchMock.mockResolvedValue(
      answer(429, {
        success: false,
        message: 'Please wait 5 minutes before running another analysis.',
      }),
    );
    expect(await trackPromptsNow('b1', ['p1'])).toEqual({
      ok: false,
      status: 429,
      message: 'Please wait 5 minutes before running another analysis.',
      code: null,
    });
    fetchMock.mockResolvedValue(
      answer(403, {
        success: false,
        message: 'Only admins and managers can run tracking.',
        code: 'forbidden',
      }),
    );
    expect(await trackPromptsNow('b1', ['p1'])).toMatchObject({ status: 403, code: 'forbidden' });
  });

  it('never throws: no session, or no answer, is a failure', async () => {
    session.value = null;
    expect(await trackPromptsNow('b1', ['p1'])).toMatchObject({ ok: false, status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
    session.value = { access_token: 'tok' };
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(await trackPromptsNow('b1', ['p1'])).toEqual({
      ok: false,
      status: 0,
      message: null,
      code: null,
    });
  });
});
