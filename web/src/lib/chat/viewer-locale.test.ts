import { beforeEach, describe, expect, it, vi } from 'vitest';
import english from '../../../messages/en.json';

/**
 * Chat's views in the language of the person looking at them: the request's
 * interface language, else their profile's, else English; English outside
 * a viewer's scope, and where the language has no text yet.
 */

const request = vi.hoisted(() => ({ locale: null as string | null }));
const profile = vi.hoisted(() => ({ row: null as { ui_language: unknown } | null }));

vi.mock('next-intl/server', () => ({
  getLocale: async () => {
    if (!request.locale) throw new Error('No request');
    return request.locale;
  },
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: profile.row, error: null }) }),
      }),
    }),
  },
}));

vi.mock('@/i18n/messages', () => ({
  loadMessages: async (locale: string) =>
    locale === 'de'
      ? {
          ...english,
          chatActivity: {
            ...english.chatActivity,
            summary: { ...english.chatActivity.summary, accessDenied: 'Nicht erlaubt: {tool}' },
            undo: { ...english.chatActivity.undo, ok: 'Rückgängig gemacht.' },
          },
          chatAccess: {
            ...english.chatAccess,
            activity: {
              ...english.chatAccess.activity,
              approval: { ...english.chatAccess.activity.approval, denied: 'Nicht erlaubt' },
              status: { ...english.chatAccess.activity.status, done: 'Erledigt' },
            },
          },
          chatTools: {
            ...english.chatTools,
            saveDraft: { ...english.chatTools.saveDraft, name: 'Entwürfe speichern' },
          },
          contentEditor: {
            ...english.contentEditor,
            editor: {
              ...english.contentEditor.editor,
              agentCard: {
                ...english.contentEditor.editor.agentCard,
                steps: {
                  ...english.contentEditor.editor.agentCard.steps,
                  gatherSources: '{count, plural, one {Sammle # Quelle} other {Sammle # Quellen}}',
                },
              },
            },
          },
          actionCenter: {
            ...english.actionCenter,
            actionTasks: {
              ...english.actionCenter.actionTasks,
              validate: 'Auf KI-Plattformen prüfen',
            },
          },
        }
      : english,
}));

const { asViewer, viewerLocale } = await import('./viewer-locale');
const { activitySummary, activityWords, deniedToolName } = await import('./activity');
const { activityCsv, shownParams } = await import('./activity-view');
const { undoMessage } = await import('./undo');
const { contentTrayRun } = await import('./runs-tray');
const { titleOfTask } = await import('./task-strip');

beforeEach(() => {
  request.locale = null;
  profile.row = null;
});

describe('viewerLocale', () => {
  it("is the request's interface language", async () => {
    request.locale = 'de';
    profile.row = { ui_language: 'fr' };
    expect(await viewerLocale('user-1')).toBe('de');
  });

  it("is the person's profile pick with no request, else English", async () => {
    profile.row = { ui_language: 'de' };
    expect(await viewerLocale('user-1')).toBe('de');
    expect(await viewerLocale()).toBe('en');
    profile.row = null;
    expect(await viewerLocale('user-1')).toBe('en');
  });
});

const deniedRow = {
  id: 'a1',
  at: '2026-10-29T10:00:00Z',
  userId: 'u1',
  person: 'Alex Kim',
  isYou: false,
  surface: 'chat',
  kind: 'access.denied' as const,
  toolKey: 'saveDraft',
  area: 'content' as const,
  class: 'write' as const,
  mode: null,
  approvalKind: null,
  autoVia: null,
  denialCode: 'role',
  summaryKey: 'accessDenied',
  summaryParams: { tool: 'Saved name' },
  status: 'done' as const,
  canUndo: false,
  undoneAt: null,
  takeDown: null,
};

const csvOf = () =>
  activityCsv(
    [{ ...deniedRow, summaryParams: shownParams(deniedRow, deniedToolName) }],
    (key, params) => activitySummary(key, params),
    activityWords,
  ).split('\n')[1];

describe("the views in the viewer's language", () => {
  it('writes the Activity log CSV in German, its saved tool name named again', async () => {
    request.locale = 'de';
    expect(await asViewer(async () => csvOf())).toBe(
      '2026-10-29T10:00:00Z,Alex Kim,chat,Nicht erlaubt: Entwürfe speichern,Entwürfe speichern,denied,,Nicht erlaubt,Erledigt',
    );
  });

  it('writes the CSV in English for an English viewer, with the saved tool name, as before', async () => {
    request.locale = 'en';
    expect(await asViewer(async () => csvOf())).toBe(
      '2026-10-29T10:00:00Z,Alex Kim,chat,Not allowed: Saved name,Save drafts in Content,denied,,Not allowed,Done',
    );
  });

  it("says Undo's answer in German, English where German has no text yet", async () => {
    request.locale = 'de';
    await asViewer(async () => {
      expect(undoMessage({ code: 'ok', activityId: null })).toBe('Rückgängig gemacht.');
      expect(undoMessage({ code: 'expired' })).toBe(english.chatActivity.undo.expired);
    });
    expect(undoMessage({ code: 'ok', activityId: null })).toBe('Undone.');
  });

  it("names a Content Agent run's step and a task in German", async () => {
    const row = {
      id: 'run-c',
      kind: 'fix',
      steps: [
        { key: 'read_rules', count: 4 },
        { key: 'gather_sources', count: 52 },
      ],
      step: 1,
      started_at: '2026-10-29T11:58:00Z',
      finished_at: null,
      stopped_at: null,
      outcome: null,
    };
    const draft = { id: '22222222-2222-4222-8222-222222222222', title: 'Pricing FAQ' };
    const now = Date.parse('2026-10-29T12:00:00Z');
    const task = { task_key: 'validate', title: null, title_params: null };
    profile.row = { ui_language: 'de' };
    await asViewer(async () => {
      expect(contentTrayRun(row, draft, now)?.stepLabel).toBe('Sammle 52 Quellen');
      expect(titleOfTask(task)).toBe('Auf KI-Plattformen prüfen');
    }, 'user-1');
    expect(contentTrayRun(row, draft, now)?.stepLabel).toBe('Gathering 52 sources');
    expect(titleOfTask(task)).toBe('Validate across AI platforms');
  });
});
