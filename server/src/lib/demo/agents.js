/**
 * The demo brand's Agent Center (demo Agent Center): four agents made from
 * the ready-to-use ones, at work on the demo brand, with their run history.
 * Each run has its chat (Open run), worded from the demo's own answers
 * (stats.js), and one run waits on its owner's OK, so the Inbox has
 * something under Needs you.
 *
 * An agent belongs to the workspace, not to a brand: these carry the demo
 * brand they show (chat_agents.demo_brand_id, 00475), and the web leaves
 * them out of whatever runs, counts or pauses agents. None of them ever
 * runs: their brand is the demo brand, every change to them is refused
 * (demo_brand), their waiting run's state has no waiting_since (the
 * engine's sweep never stops it), and a click on its card is refused
 * (demo_brand) before anything resumes. Their owner is the organization's first person, who
 * gets the runs' chats; everyone else sees them as workspace agents.
 */

import supabaseAdmin from '../../config/supabase.js';
import { IMPROVE_PLATFORM_LABELS } from '../prompt-improve.js';
import { BRAND, PLATFORMS } from './brewline.js';
import { addChat, emptyChatRows, readPeople, writeChatRows } from './chat.js';
import { RUNS } from './core.js';
import { demoId } from './random.js';
import { demoWriter } from './write.js';
import * as S from './stats.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The latest times before `now` a weekly schedule fired, newest first: on
 * `days` (0 is Sunday) at `hour` UTC, skipping the newest `skip`.
 */
function lastSlots(now, days, hour, count, skip = 0) {
  const slots = [];
  for (let d = 0; slots.length < count + skip && d < 60; d++) {
    const day = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - d, hour),
    );
    if (days.includes(day.getUTCDay()) && day < now) slots.push(day);
  }
  return slots.slice(skip);
}
const LATEST = RUNS - 1;
const pct = (n) => `${n}%`;
const platformName = (id) => IMPROVE_PLATFORM_LABELS[id] ?? id;
const ALL_PLATFORMS = PLATFORMS.map((p) => platformName(p.id));

/** A run's first message, as the agent driver words one (chatAgents.runner). */
function runMessage(agent, trigger) {
  const skills = agent.skills.map((s) => `/${s}`).join(', then ');
  const started = {
    schedule: 'It started on its schedule.',
    signal: 'It started because Action Center found a new signal.',
  }[trigger];
  return [
    `Run the agent “${agent.name}” for ${BRAND.name}: ${skills}.`,
    started,
    'This run works in the background. When a question comes up, take the recommended option and list your assumptions at the top of the answer. Changes still wait for approval as the agent’s mode says.',
  ].join('\n\n');
}

const read = (label, dateRange, rows, tool, platforms = ALL_PLATFORMS) => ({
  kind: 'read',
  label,
  detail: [dateRange, platforms.join(', '), `${rows} ${rows === 1 ? 'row' : 'rows'}`]
    .filter(Boolean)
    .join(' · '),
  scope: { dateRange, platforms, brand: BRAND.name },
  rows,
  tool,
});

/**
 * The agents and their runs, worded from the demo's numbers: each
 * `{ key, name, skills, mode, status, pausedReason?, triggers, runs }`,
 * a run being `{ key, trigger, at, workingMs, steps, answer, sources,
 * dataAsOf, outcome?, waiting? }`.
 */
function agentScripts({ brandId, now }) {
  const ctx = S.demoContext(brandId, now);
  const { results, citations } = ctx.rows;
  // Before now, whatever the runs' hours.
  const at = (run, hours, minutesAgo = 30) =>
    new Date(
      Math.min(S.afterRun(ctx.starts, run, hours).getTime(), now.getTime() - minutesAgo * 60_000),
    );
  const asOf = (rows) =>
    rows.reduce((latest, r) => (r.created_at > latest ? r.created_at : latest), '');
  const runOf = (i) => S.runResults(results, [i]);
  // The latest check whose answers were in by `at` (each takes under two hours).
  const checkBefore = (at) => {
    let i = LATEST;
    while (i > 1 && ctx.starts[i].getTime() + 2 * HOUR_MS > at.getTime()) i -= 1;
    return i;
  };

  // ── Visibility watch: Mondays and Thursdays at 08:00, on the latest check ───
  const watchRuns = lastSlots(now, [1, 4], 8, 3).map((slot) => {
    const i = checkBefore(slot);
    const now_ = S.brandStats(runOf(i));
    const before = S.brandStats(runOf(i - 1));
    const moved = PLATFORMS.map((p) => ({
      name: platformName(p.id),
      change:
        S.brandStats(runOf(i).filter((r) => r.model_used === p.id)).mentionRate -
        S.brandStats(runOf(i - 1).filter((r) => r.model_used === p.id)).mentionRate,
    })).sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0];
    const change = Math.round((now_.mentionRate - before.mentionRate) * 10) / 10;
    return {
      key: `watch:${slot.toISOString().slice(0, 10)}`,
      trigger: 'schedule',
      at: slot,
      workingMs: 24_000,
      dataAsOf: asOf(runOf(i)),
      steps: [read('Read Visibility', 'Latest check', runOf(i).length, 'get_visibility')],
      answer: [
        `**Brewline is named in ${pct(now_.mentionRate)} of AI answers** in this check (${change >= 0 ? '+' : ''}${change} points against the one before). Its AI Visibility Score is ${now_.score}.`,
        '',
        Math.abs(moved.change) >= 5
          ? `${moved.name} moved most: ${moved.change > 0 ? 'up' : 'down'} ${Math.abs(Math.round(moved.change * 10) / 10)} points.`
          : 'No platform moved by 5 points or more, so there is nothing to act on.',
      ].join('\n'),
      sources: [{ label: 'Visibility', count: runOf(i).length }],
    };
  });

  // ── Citation win-back: on a signal; the latest one waits for a draft's OK ───
  const recent = S.runResults(results, [LATEST - 2, LATEST - 1, LATEST]);
  const recentIds = new Set(recent.map((r) => r.id));
  const ownCited = citations.filter(
    (c) => recentIds.has(c.prompt_result_id) && c.domain === BRAND.domain,
  ).length;
  const forumCited = citations.filter(
    (c) => recentIds.has(c.prompt_result_id) && c.domain === 'brewersforum.example',
  ).length;
  const winbackRuns = [
    {
      key: 'winback:done',
      trigger: 'signal',
      at: at(LATEST - 2, 5, 6 * 24 * 60),
      workingMs: 41_000,
      dataAsOf: asOf(S.runResults(results, [LATEST - 2])),
      outcome: { outcome: 'improved', confidence: 'medium' },
      steps: [
        read('Read Citations', 'Last 9 days', ownCited, 'get_citations'),
        read('Read Library', 'All drafts', 3, 'list_drafts', []),
      ],
      answer: [
        'Action Center found that answers about pausing or skipping a delivery stopped citing brewline.example.',
        '',
        'The help page draft **How to Pause, Skip or Reschedule Your Coffee Subscription** already answers it, so I checked it against the questions people ask and left it for your review in the Content Editor. Nothing was published.',
      ].join('\n'),
      sources: [
        { label: 'Citations', count: ownCited },
        { label: 'Library', count: 3 },
      ],
    },
    {
      key: 'winback:waiting',
      trigger: 'signal',
      at: at(LATEST, 4, 3 * 60),
      workingMs: 33_000,
      dataAsOf: asOf(runOf(LATEST)),
      steps: [read('Read Citations', 'Last 9 days', forumCited, 'get_citations')],
      answer: [
        `brewersforum.example is cited ${forumCited} times in answers to your prompts over the last three checks, but its threads link to other roasters, not to brewline.example.`,
        '',
        'A short FAQ on cold brew at home would give those threads a page of yours to link to. I wrote it and need your OK to save it as a draft in Content.',
      ].join('\n'),
      sources: [{ label: 'Citations', count: forumCited }],
      waiting: {
        step: { kind: 'write', label: 'Save drafts in Content', tool: 'save_draft' },
        confirm: {
          action: 'Save a draft in Content',
          target: `Cold brew at home: your questions answered · ${BRAND.name}`,
          digest: 'd'.repeat(64),
          canDontAskAgain: false,
          why: 'brewersforum.example is cited often for cold brew questions, and links to other roasters.',
          goal: 'Give those answers a Brewline page to cite.',
          items: [
            {
              title: 'Cold brew at home: your questions answered',
              detail: '6 questions · about 900 words',
            },
          ],
        },
      },
    },
  ];

  // ── Competitor watch: Mondays at 09:00, on the last two checks ─────────────
  const leaderOf = (rows) =>
    [...S.competitorStats(rows).values()].sort((a, b) => b.mentionRate - a.mentionRate)[0];
  const competitorRuns = lastSlots(now, [1], 9, 2).map((slot) => {
    const i = checkBefore(slot);
    const rows = S.runResults(results, [i - 1, i]);
    const leader = leaderOf(rows);
    const own = S.brandStats(rows);
    return {
      key: `competitor:${slot.toISOString().slice(0, 10)}`,
      trigger: 'schedule',
      at: slot,
      workingMs: 37_000,
      dataAsOf: asOf(rows),
      steps: [
        read('Read Competitors', 'Last 7 days', 4, 'get_competitors'),
        read('Read Mentions · Competitors', 'Last 7 days', rows.length, 'get_mention_competitors'),
      ],
      answer: [
        `**${leader.name}** leads this week: named in ${pct(leader.mentionRate)} of answers, Brewline in ${pct(own.mentionRate)}.`,
        '',
        'The Action Center already tracks closing that gap, so I added no new task. I’ll compare again next Monday.',
      ].join('\n'),
      sources: [
        { label: 'Competitors', count: 4 },
        { label: 'Mentions · Competitors', count: rows.length },
      ],
    };
  });

  // ── Weekly report: Fridays at 16:00, paused by hand after two of them ──────
  const reportRuns = lastSlots(now, [5], 16, 2, 1).map((slot) => {
    const i = checkBefore(slot);
    const rows = S.runResults(results, [i - 1, i]);
    const own = S.brandStats(rows);
    return {
      key: `report:${slot.toISOString().slice(0, 10)}`,
      trigger: 'schedule',
      at: slot,
      workingMs: 52_000,
      dataAsOf: asOf(rows),
      steps: [
        read('Read Visibility trend', 'Last 7 days', rows.length, 'get_visibility_trend'),
        read('Read Competitors', 'Last 7 days', 4, 'get_competitors'),
      ],
      answer: [
        `**This week:** Brewline is named in ${pct(own.mentionRate)} of AI answers, with ${own.citations} citations of its pages.`,
        '',
        `The full report is in Reports as “Weekly Visibility Summary”.`,
      ].join('\n'),
      sources: [
        { label: 'Visibility trend', count: rows.length },
        { label: 'Competitors', count: 4 },
      ],
    };
  });

  return [
    {
      key: 'visibility-watch',
      name: 'Brewline visibility watch',
      skills: ['report'],
      mode: 'auto',
      status: 'active',
      triggers: [
        {
          kind: 'schedule',
          config: {
            type: 'recurring',
            rrule: 'FREQ=WEEKLY;BYDAY=MO,TH;BYHOUR=8;BYMINUTE=0',
            timezone: 'UTC',
          },
        },
      ],
      runs: watchRuns,
    },
    {
      key: 'citation-winback',
      name: 'Brewline citation win-back',
      skills: ['winback', 'faq'],
      mode: 'auto',
      status: 'active',
      triggers: [{ kind: 'signal', config: { category: 'recover' } }],
      runs: winbackRuns,
    },
    {
      key: 'competitor-watch',
      name: 'Brewline competitor watch',
      skills: ['beat', 'compare'],
      mode: 'auto',
      status: 'active',
      triggers: [
        { kind: 'signal', config: { category: 'compete' } },
        {
          kind: 'schedule',
          config: {
            type: 'recurring',
            rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0',
            timezone: 'UTC',
          },
        },
      ],
      runs: competitorRuns,
    },
    {
      key: 'weekly-report',
      name: 'Brewline weekly report',
      skills: ['report'],
      mode: 'full_auto',
      status: 'paused',
      pausedReason: 'manual',
      triggers: [
        {
          kind: 'schedule',
          config: {
            type: 'recurring',
            rrule: 'FREQ=WEEKLY;BYDAY=FR;BYHOUR=16;BYMINUTE=0',
            timezone: 'UTC',
          },
        },
      ],
      runs: reportRuns,
    },
  ];
}

/**
 * Every row of the demo's agents, in memory: the agents, their versions
 * and triggers, their runs and each run's chat (its owner's). Deterministic
 * but for the dates.
 *
 * @param {{ brandId: string, now: Date, organizationId: string, ownerId: string }} args
 */
export function agentRows({ brandId, now, organizationId, ownerId }) {
  const scripts = agentScripts({ brandId, now });
  const rows = { agents: [], versions: [], triggers: [], runs: [], chats: emptyChatRows() };
  const madeAt = new Date(now.getTime() - 21 * DAY_MS).toISOString();
  for (const agent of scripts) {
    const id = (key) => demoId(brandId, `agent:${agent.key}:${key}`);
    const agentId = id('agent');
    const lastRun = [...agent.runs].sort((a, b) => b.at - a.at)[0];
    rows.agents.push({
      id: agentId,
      organization_id: organizationId,
      name: agent.name,
      status: agent.status,
      paused_reason: agent.pausedReason ?? null,
      owner_id: ownerId,
      visibility: 'workspace',
      version: 1,
      fail_count: 0,
      max_run_share: 0.1,
      created_by: ownerId,
      created_at: madeAt,
      updated_at: (agent.status === 'paused' ? lastRun.at : new Date(madeAt)).toISOString(),
      activated_at: madeAt,
      demo_brand_id: brandId,
    });
    rows.versions.push({
      agent_id: agentId,
      version: 1,
      skill_ids: agent.skills,
      instructions: null,
      mode: agent.mode,
      connections: [],
      model: 'auto',
      effort: 'normal',
      scope: { brand_ids: [brandId] },
      notify_user_ids: [],
      followup_days: 14,
      created_by: ownerId,
      created_at: madeAt,
    });
    agent.triggers.forEach((trigger, i) => {
      const fired = agent.runs.filter((r) => r.trigger === trigger.kind);
      const last = fired.length ? new Date(Math.max(...fired.map((r) => r.at.getTime()))) : null;
      rows.triggers.push({
        id: id(`trigger:${i}`),
        agent_id: agentId,
        kind: trigger.kind,
        config_json: trigger.config,
        enabled: true,
        last_fired_at: last ? last.toISOString() : null,
        created_at: madeAt,
        updated_at: madeAt,
      });
    });
    for (const run of agent.runs) {
      const runId = id(`run:${run.key}`);
      const trigger = agent.triggers.findIndex((t) => t.kind === run.trigger);
      const startedAt = new Date(run.at.getTime() + 1000);
      const waiting = Boolean(run.waiting);
      rows.runs.push({
        id: runId,
        organization_id: organizationId,
        agent_id: agentId,
        agent_version: 1,
        brand_id: brandId,
        trigger_kind: run.trigger,
        trigger_id: trigger >= 0 ? id(`trigger:${trigger}`) : null,
        acting_user_id: ownerId,
        status: waiting ? 'needs_you' : 'done',
        evidence_json: {},
        max_share: 0.1,
        usage_share: Math.round((run.workingMs / 1_000_000) * 10_000) / 10_000,
        outcome: run.outcome?.outcome ?? null,
        outcome_confidence: run.outcome?.confidence ?? null,
        queued_at: run.at.toISOString(),
        started_at: startedAt.toISOString(),
        finished_at: waiting ? null : new Date(startedAt.getTime() + run.workingMs).toISOString(),
      });
      // Its chat, as the agent driver opens one (origin agent, the owner's).
      const chatId = (key) => demoId(brandId, `agent:${agent.key}:run:${run.key}:${key}`);
      addChat(rows.chats, {
        id: chatId,
        conversation: {
          id: chatId('conversation'),
          organization_id: organizationId,
          user_id: ownerId,
          brand_id: brandId,
          title: `${agent.name} · ${BRAND.name}`,
          origin: 'agent',
          origin_page: null,
          agent_run_id: runId,
        },
        turns: [{ ...run, question: runMessage(agent, run.trigger) }],
        // The last day's results, and a run waiting, are news in the Inbox; older ones were read.
        read: !run.waiting && now.getTime() - run.at.getTime() > DAY_MS,
      });
    }
  }
  return rows;
}

/**
 * Deletes the demo brand's agents, their versions and triggers with them.
 * Their runs and runs' chats are the demo brand's (chat_agent_runs,
 * chat_conversations), cleared or hidden with it.
 *
 * @param {object} db supabase client
 * @param {string} brandId the demo brand
 */
export async function hideDemoAgents(db, brandId) {
  // Their runs first: a deleted agent's runs stay (agent_id set null), and a
  // sample run left waiting would never be settled (the sweep skips demo brands).
  const runs = await db.from('chat_agent_runs').delete().eq('brand_id', brandId);
  if (runs.error) throw new Error(`demo agent runs delete: ${runs.error.message}`);
  const { error } = await db.from('chat_agents').delete().eq('demo_brand_id', brandId);
  if (error) throw new Error(`demo agents delete: ${error.message}`);
}

export const agents = {
  name: 'agents',
  // After the chats: their module clears the brand's chats, the agents' runs' chats among them.
  after: 'chat',
  // Cleared just before it is built (index.js); the agents themselves go by their demo brand.
  tables: ['chat_agent_runs'],
  keys: {
    chat_agent_versions: 'agent_id,version',
    chat_run_events: 'run_id,seq',
    chat_run_state: 'run_id',
  },

  /**
   * Through the build's writer (a writer over `db` for a first build without one).
   *
   * @param {{ brandId: string, now: Date, db?: object, write?: Function }} ctx
   */
  async build({
    brandId,
    now,
    db = supabaseAdmin,
    write = demoWriter({ db, brandId, keys: agents.keys }).write,
  }) {
    await hideDemoAgents(db, brandId);
    const { organizationId, userIds } = await readPeople(db, brandId);
    if (userIds.length === 0) return { agents: 0, runs: 0 };
    const rows = agentRows({ brandId, now, organizationId, ownerId: userIds[0] });
    await write('chat_agents', rows.agents);
    await Promise.all([
      write('chat_agent_versions', rows.versions),
      write('chat_agent_triggers', rows.triggers),
    ]);
    await write('chat_agent_runs', rows.runs);
    await writeChatRows(write, rows.chats);
    return { agents: rows.agents.length, runs: rows.runs.length };
  },
};
