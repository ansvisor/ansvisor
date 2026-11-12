/**
 * The person's PostHog rows (posthog.js) made into what the team reads:
 * which days they came, where they went and what they did each day, where
 * they got stuck, and the sessions worth watching. Pure: no reads here.
 *
 * Days are UTC dates, worked out here from each row's moment (PostHog
 * answers in the project's time zone). Pages are paths with ids as :id and
 * no /en prefix. Property values are kept only when they look like the
 * app's own names (`brand_add`, `plan_limit`): anything else, a domain or a
 * sentence, is dropped, so nothing the customer typed reaches the e-mail or
 * the model.
 */

/** Pages listed a day, at most; the rest are counted. */
export const PAGES_PER_DAY = 12;
/** Sessions to watch, at most. */
export const MAX_REPLAYS = 3;

/** The cancel flow's events (web/src/lib/billing/cancel-events.ts, #2276). */
export const CANCEL_EVENTS = [
  'cancel_dialog_opened',
  'cancel_dialog_closed',
  'subscription_canceled',
  'cancel_wait_requested',
  'subscription_reactivated',
];

/** The friction events the web sends (the friction-events change): their names are the contract. */
export const FRICTION_EVENTS = {
  wall: 'upgrade_wall_shown',
  error: 'error_shown',
  started: 'flow_started',
  completed: 'flow_completed',
  failed: 'flow_failed',
};

const UUID = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
/** A path segment that is an id all the same: a long number, or a long token with digits in it. */
const ID_SEGMENT = /^(\d{4,}|(?=[A-Za-z_-]*\d)[A-Za-z0-9_-]{20,})$/;

/**
 * A page as the team reads it: a full address (a heatmap's) as its path, ids
 * as :id, no /en prefix (web/src/i18n/routing.ts) and no trailing slash, so
 * a brand's pages group together and no id leaves the server. '' for none.
 */
export function normalisePath(value) {
  let path = String(value ?? '').trim();
  if (!path) return '';
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return '';
    }
  }
  path = path.split(/[?#]/)[0].replace(UUID, ':id');
  path = path
    .split('/')
    .map((segment) => (ID_SEGMENT.test(segment) ? ':id' : segment))
    .join('/')
    .replace(/^\/en(?=\/|$)/, '')
    .replace(/(.)\/+$/, '$1');
  if (!path) return '/';
  return path.startsWith('/') ? path.slice(0, 300) : '';
}

/** An app name as an event carries it (`brand_add`, `plan_limit`, `403`), or null. */
export function token(value) {
  const text = typeof value === 'number' ? String(value) : value;
  return typeof text === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(text) ? text : null;
}

/** A product event's name, or null: no `$`, none of what a person could write. */
const eventName = (value) =>
  typeof value === 'string' && !value.startsWith('$') && /^[\w :-]{1,80}$/.test(value)
    ? value
    : null;

/** A PostHog session id, or null. */
const sessionId = (value) =>
  typeof value === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(value) ? value : null;

/** A row's moment in ms, or null (ClickHouse's empty moment is 1970). */
function momentOf(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) && new Date(ms).getUTCFullYear() > 2000 ? ms : null;
}

/** The UTC date of a moment: '2026-11-09'. */
export const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

const count = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

const bump = (map, key, by = 1) => map.set(key, (map.get(key) ?? 0) + by);

/** A Map's keys by their count, most first, then by name. */
const byCount = (map) =>
  [...map].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));

/** The rows as the rest reads them, oldest first. */
function tidy({ pageviews = [], events = [], clicks = [] }) {
  const visits = pageviews
    .map((row) => ({
      at: momentOf(row.timestamp),
      page: normalisePath(row.pathname),
      sid: sessionId(row.sid),
    }))
    .filter((visit) => visit.at)
    .sort((a, b) => a.at - b.at);
  const acts = events
    .map((row) => ({
      event: eventName(row.event),
      at: momentOf(row.timestamp),
      page: normalisePath(row.pathname),
      sid: sessionId(row.sid),
      feature: token(row.feature),
      reason: token(row.reason),
      source: token(row.source),
      kind: token(row.kind),
      flow: token(row.flow),
      target: token(row.target),
      errorCode: token(row.error_code),
    }))
    .filter((act) => act.event && act.at)
    .sort((a, b) => a.at - b.at);
  const marks = clicks
    .map((row) => ({
      page: normalisePath(row.url),
      sid: sessionId(row.sid),
      type: row.type === 'rageclick' ? 'rage' : row.type === 'deadclick' ? 'dead' : null,
      n: count(row.n),
      at: momentOf(row.first_at),
    }))
    .filter((mark) => mark.type && mark.n);
  return { visits, acts, marks };
}

/**
 * Each day they came, oldest first: the pages in the order they went
 * (the same page twice in a row once; PAGES_PER_DAY at most, the rest
 * counted), the product events with their counts, and the sessions.
 */
export function dayByDay({ visits, acts }, replayUrl = () => null) {
  const days = new Map();
  const dayEntry = (at) => {
    const day = dayOf(at);
    if (!days.has(day)) days.set(day, { pages: [], events: new Map(), sessions: [] });
    return days.get(day);
  };
  const addSession = (entry, sid) => {
    if (sid && !entry.sessions.includes(sid)) entry.sessions.push(sid);
  };
  for (const visit of visits) {
    const entry = dayEntry(visit.at);
    if (visit.page && entry.pages.at(-1) !== visit.page) entry.pages.push(visit.page);
    addSession(entry, visit.sid);
  }
  for (const act of acts) {
    const entry = dayEntry(act.at);
    bump(entry.events, act.event);
    addSession(entry, act.sid);
  }
  return [...days]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, entry]) => ({
      day,
      pages: entry.pages.slice(0, PAGES_PER_DAY),
      morePages: Math.max(0, entry.pages.length - PAGES_PER_DAY),
      events: byCount(entry.events).map(([event, n]) => ({ event, count: n })),
      sessions: entry.sessions.map((id) => ({ id, url: replayUrl(id) })),
    }));
}

/** A group's set of names as a sorted list. */
const listOf = (set) => [...set].filter(Boolean).sort();

/**
 * Where they got stuck: the upgrade walls they met by feature, the errors
 * they saw by page, the flows they started and didn't finish by flow, their
 * rage and dead clicks by page, and the cancel flow's steps in order.
 */
export function frictionOf({ acts, marks }) {
  const walls = new Map();
  const errors = new Map();
  const flows = new Map();
  const group = (map, key, make) => {
    if (!map.has(key)) map.set(key, make());
    return map.get(key);
  };
  for (const act of acts) {
    if (act.event === FRICTION_EVENTS.wall) {
      const wall = group(walls, act.feature ?? 'unknown', () => ({
        count: 0,
        reasons: new Set(),
        sources: new Set(),
      }));
      wall.count += 1;
      wall.reasons.add(act.reason);
      wall.sources.add(act.source);
    } else if (act.event === FRICTION_EVENTS.error) {
      const error = group(errors, act.page || 'unknown', () => ({ count: 0, kinds: new Set() }));
      error.count += 1;
      error.kinds.add(act.kind);
    } else if (
      act.event === FRICTION_EVENTS.started ||
      act.event === FRICTION_EVENTS.completed ||
      act.event === FRICTION_EVENTS.failed
    ) {
      const flow = group(flows, act.flow ?? 'unknown', () => ({
        started: 0,
        completed: 0,
        failed: 0,
        errorCodes: new Set(),
        targets: new Set(),
      }));
      if (act.event === FRICTION_EVENTS.started) flow.started += 1;
      if (act.event === FRICTION_EVENTS.completed) flow.completed += 1;
      if (act.event === FRICTION_EVENTS.failed) {
        flow.failed += 1;
        flow.errorCodes.add(act.errorCode);
      }
      flow.targets.add(act.target);
    }
  }

  const clicks = new Map();
  for (const mark of marks) {
    const page = group(clicks, mark.page || 'unknown', () => ({ rage: 0, dead: 0 }));
    page[mark.type] += mark.n;
  }

  return {
    walls: [...walls]
      .map(([feature, wall]) => ({
        feature,
        count: wall.count,
        reasons: listOf(wall.reasons),
        sources: listOf(wall.sources),
      }))
      .sort((a, b) => b.count - a.count || a.feature.localeCompare(b.feature)),
    errorsByPage: [...errors]
      .map(([page, error]) => ({ page, count: error.count, kinds: listOf(error.kinds) }))
      .sort((a, b) => b.count - a.count || a.page.localeCompare(b.page)),
    flowsNotFinished: [...flows]
      .map(([flow, f]) => ({
        flow,
        started: f.started,
        completed: f.completed,
        failed: f.failed,
        notCompleted: Math.max(0, f.started - f.completed),
        errorCodes: listOf(f.errorCodes),
        targets: listOf(f.targets),
      }))
      .filter((f) => f.notCompleted > 0 || f.failed > 0)
      .sort(
        (a, b) =>
          b.notCompleted + b.failed - (a.notCompleted + a.failed) || a.flow.localeCompare(b.flow),
      ),
    clicksByPage: [...clicks]
      .map(([page, c]) => ({ page, rage: c.rage, dead: c.dead }))
      .sort((a, b) => b.rage + b.dead - (a.rage + a.dead) || a.page.localeCompare(b.page)),
    cancelFlow: acts
      .filter((act) => CANCEL_EVENTS.includes(act.event))
      .map((act) => ({ event: act.event, at: new Date(act.at).toISOString() })),
  };
}

/**
 * The sessions with the most friction (rage and dead clicks, errors, walls
 * and failed flows, each one point), MAX_REPLAYS at most, the most recent
 * first among equals: the day it started, the page where most of it
 * happened (or the one they viewed most), and its replay. Sessions without
 * friction aren't listed.
 */
export function pickReplays({ visits, acts, marks }, replayUrl = () => null) {
  const sessions = new Map();
  const of = (sid) => {
    if (!sessions.has(sid)) {
      sessions.set(sid, {
        rage: 0,
        dead: 0,
        errors: 0,
        walls: 0,
        failedFlows: 0,
        firstAt: null,
        friction: new Map(),
        views: new Map(),
      });
    }
    return sessions.get(sid);
  };
  const seen = (session, at) => {
    if (at && (session.firstAt === null || at < session.firstAt)) session.firstAt = at;
  };
  for (const visit of visits) {
    if (!visit.sid) continue;
    const session = of(visit.sid);
    seen(session, visit.at);
    if (visit.page) bump(session.views, visit.page);
  }
  for (const act of acts) {
    if (!act.sid) continue;
    const session = of(act.sid);
    seen(session, act.at);
    const field =
      act.event === FRICTION_EVENTS.error
        ? 'errors'
        : act.event === FRICTION_EVENTS.wall
          ? 'walls'
          : act.event === FRICTION_EVENTS.failed
            ? 'failedFlows'
            : null;
    if (!field) continue;
    session[field] += 1;
    if (act.page) bump(session.friction, act.page);
  }
  for (const mark of marks) {
    if (!mark.sid) continue;
    const session = of(mark.sid);
    seen(session, mark.at);
    session[mark.type] += mark.n;
    if (mark.page) bump(session.friction, mark.page, mark.n);
  }

  return [...sessions]
    .map(([id, s]) => ({
      id,
      score: s.rage + s.dead + s.errors + s.walls + s.failedFlows,
      firstAt: s.firstAt,
      day: s.firstAt ? dayOf(s.firstAt) : null,
      page: byCount(s.friction)[0]?.[0] ?? byCount(s.views)[0]?.[0] ?? null,
      rage: s.rage,
      dead: s.dead,
      errors: s.errors,
      walls: s.walls,
      failedFlows: s.failedFlows,
      url: replayUrl(id),
    }))
    .filter((session) => session.score > 0)
    .sort((a, b) => b.score - a.score || (b.firstAt ?? 0) - (a.firstAt ?? 0))
    .slice(0, MAX_REPLAYS)
    .map(({ firstAt: _firstAt, ...session }) => session);
}

/**
 * The analysis's PostHog part from readPersonRows' answer: the totals, day
 * by day, where they got stuck, the replays to watch and the link to the
 * person in PostHog. `truncated`: a query hit its row limit, so the oldest
 * days may be missing.
 */
export function summariseActivity(rows, { distinctId, rowLimit = Infinity } = {}) {
  const tidied = tidy(rows);
  const project = `${rows.appHost}/project/${encodeURIComponent(rows.projectId)}`;
  // PostHog's replay page (products/replay/manifest.tsx: /replay/{id}, under /project/{id}).
  const replayUrl = (id) => `${project}/replay/${encodeURIComponent(id)}`;
  const days = dayByDay(tidied, replayUrl);
  const sessions = new Set(
    [...tidied.visits, ...tidied.acts].map((row) => row.sid).filter(Boolean),
  );
  const moments = [...tidied.visits, ...tidied.acts].map((row) => row.at);
  return {
    ok: true,
    days: rows.days,
    totals: {
      activeDays: days.length,
      sessions: sessions.size,
      pageviews: tidied.visits.length,
      lastSeen: moments.length ? new Date(Math.max(...moments)).toISOString() : null,
    },
    truncated: (rows.pageviews?.length ?? 0) >= rowLimit || (rows.events?.length ?? 0) >= rowLimit,
    dayByDay: days,
    friction: frictionOf(tidied),
    replays: pickReplays(tidied, replayUrl),
    personUrl: `${project}/person/${encodeURIComponent(distinctId)}`,
  };
}
