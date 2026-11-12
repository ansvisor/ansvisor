// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const permanentRedirect = vi.fn();
vi.mock('next/navigation', () => ({
  permanentRedirect: (url: string) => permanentRedirect(url),
}));

const { default: ActionCenterAgentsRedirect } = await import('./page');

const open = (path: string[] | undefined, query: Record<string, string | string[]> = {}) =>
  ActionCenterAgentsRedirect({
    params: Promise.resolve(path ? { path } : {}),
    searchParams: Promise.resolve(query),
  });

describe('/dashboard/action-center/agents', () => {
  it('sends the Action Center’s agents path to Agent Center, same subpath and query', async () => {
    await open(undefined);
    expect(permanentRedirect).toHaveBeenLastCalledWith('/dashboard/agents');
    await open(['new'], { skill: 'winback' });
    expect(permanentRedirect).toHaveBeenLastCalledWith('/dashboard/agents/new?skill=winback');
    await open(['a1', 'edit']);
    expect(permanentRedirect).toHaveBeenLastCalledWith('/dashboard/agents/a1/edit');
  });
});
