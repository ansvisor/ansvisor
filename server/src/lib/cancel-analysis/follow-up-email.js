import { escapeHtml } from '../cancel-feedback.js';

/**
 * The e-mail that follows the team's cancel e-mail in its thread: the AI's
 * analysis first (in Turkish), then day by day, where they got stuck, the
 * replays to watch, what the workspace never used, and the person in
 * PostHog. Plain inline styles like the first e-mail, for any mail client;
 * everything shown is escaped.
 */

const MUTED = 'color:#464442;';
const TEXT = 'font-size:14px;';
/** Sessions linked a day, at most. */
const SESSIONS_PER_DAY = 6;

const numberFormat = new Intl.NumberFormat('en-US');
const n = (value) => numberFormat.format(value ?? 0);
const plural = (value, one, many = `${one}s`) => `${n(value)} ${value === 1 ? one : many}`;

/** '2026-11-09' as 'Mon, November 9'. */
const formatDay = (day) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

/** A moment as 'November 9, 16:45 UTC'. */
const formatMoment = (iso) => {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
  const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return `${date}, ${time} UTC`;
};

const heading = (text) =>
  `<p style="margin:24px 0 8px;font-size:15px;font-weight:600;">${escapeHtml(text)}</p>`;
const label = (text) => `<p style="margin:12px 0 4px;${TEXT}${MUTED}">${escapeHtml(text)}</p>`;
const line = (html, style = '') => `<p style="margin:0 0 6px;${TEXT}${style}">${html}</p>`;
const muted = (text) => line(escapeHtml(text), MUTED);
const link = (url, text) =>
  `<a href="${escapeHtml(url)}" style="color:#1C1A17;">${escapeHtml(text)}</a>`;
const list = (items, tag = 'ul') =>
  `<${tag} style="margin:0;padding:0 0 0 20px;${TEXT}">${items
    .map((item) => `<li style="margin:0 0 4px;">${item}</li>`)
    .join('')}</${tag}>`;
const detail = (text) => ` <span style="${MUTED}">${escapeHtml(text)}</span>`;

function analysisSection(ai) {
  if (!ai?.ok) {
    return muted("The AI analysis didn't come back, so this e-mail has only the data below.");
  }
  const fixes = ai.fixes.length
    ? list(
        ai.fixes.map(
          (fix) => `${escapeHtml(fix.item)}${fix.evidence ? detail(`— ${fix.evidence}`) : ''}`,
        ),
        'ol',
      )
    : muted('Veride dayanacak bir düzeltme yok.');
  return `${heading('Neden iptal etmiş olabilir?')}
${line(escapeHtml(ai.why))}
${heading('Bizim düzeltmemiz gerekenler')}
${fixes}
<p style="margin:8px 0 0;font-size:12px;${MUTED}">Written by AI from the data below only; check it against the data.</p>`;
}

function daysSection(activity) {
  const { totals } = activity;
  const summary = muted(
    [
      plural(totals.activeDays, 'active day'),
      plural(totals.sessions, 'session'),
      plural(totals.pageviews, 'page view'),
      totals.lastSeen ? `last seen ${formatMoment(totals.lastSeen)}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
  );
  if (!activity.dayByDay.length) return `${summary}\n${muted('They didn’t come in these days.')}`;
  const days = activity.dayByDay.map((day) => {
    const pages = day.pages.length
      ? `${day.pages.map(escapeHtml).join(' → ')}${day.morePages ? detail(`+${n(day.morePages)} more`) : ''}`
      : `<span style="${MUTED}">No page views</span>`;
    const events = day.events.length
      ? day.events.map((e) => `${escapeHtml(e.event)} ×${n(e.count)}`).join(', ')
      : `<span style="${MUTED}">No product events</span>`;
    const shown = day.sessions.slice(0, SESSIONS_PER_DAY);
    const sessions = shown
      // Its last characters: a session id (UUIDv7) starts with its moment, the same all day.
      .map((session) => (session.url ? link(session.url, session.id.slice(-6)) : ''))
      .filter(Boolean)
      .join(', ');
    const more = day.sessions.length - shown.length;
    return `<tr><td style="padding:6px 12px 6px 0;vertical-align:top;${TEXT}${MUTED}white-space:nowrap;">${escapeHtml(formatDay(day.day))}</td><td style="padding:6px 0;vertical-align:top;${TEXT}">${pages}<br><span style="font-size:13px;">${events}</span>${
      sessions
        ? `<br><span style="font-size:12px;${MUTED}">Sessions: ${sessions}${more > 0 ? ` +${n(more)}` : ''}</span>`
        : ''
    }</td></tr>`;
  });
  return `${summary}
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
${days.join('\n')}
</table>${
    activity.truncated
      ? `\n${muted('They did more than one read brings back: the oldest days may be missing.')}`
      : ''
  }`;
}

function stuckSection({ friction }) {
  const parts = [];
  if (friction.walls.length) {
    parts.push(
      label('Upgrade walls'),
      list(
        friction.walls.map(
          (wall) =>
            `${escapeHtml(wall.feature)}${detail(
              [
                `×${n(wall.count)}`,
                wall.reasons.length ? `reason ${wall.reasons.join(', ')}` : null,
              ]
                .filter(Boolean)
                .join(' · '),
            )}`,
        ),
      ),
    );
  }
  if (friction.errorsByPage.length) {
    parts.push(
      label('Errors'),
      list(
        friction.errorsByPage.map(
          (error) =>
            `${escapeHtml(error.page)}${detail(
              [`×${n(error.count)}`, error.kinds.length ? error.kinds.join(', ') : null]
                .filter(Boolean)
                .join(' · '),
            )}`,
        ),
      ),
    );
  }
  if (friction.flowsNotFinished.length) {
    parts.push(
      label('Flows not finished'),
      list(
        friction.flowsNotFinished.map(
          (flow) =>
            `${escapeHtml(flow.flow)}${detail(
              [
                `started ${n(flow.started)}`,
                `completed ${n(flow.completed)}`,
                `failed ${n(flow.failed)}`,
                flow.errorCodes.length ? `codes ${flow.errorCodes.join(', ')}` : null,
              ]
                .filter(Boolean)
                .join(' · '),
            )}`,
        ),
      ),
    );
  }
  if (friction.clicksByPage.length) {
    parts.push(
      label('Rage and dead clicks'),
      list(
        friction.clicksByPage.map(
          (page) =>
            `${escapeHtml(page.page)}${detail(`${plural(page.rage, 'rage click')} · ${plural(page.dead, 'dead click')}`)}`,
        ),
      ),
    );
  }
  if (friction.cancelFlow.length) {
    parts.push(
      label('Cancel flow'),
      list(
        friction.cancelFlow.map(
          (step) => `${escapeHtml(step.event)}${detail(formatMoment(step.at))}`,
        ),
      ),
    );
  }
  if (!parts.length) {
    return muted(
      'Nothing recorded: no upgrade walls, errors, unfinished flows or rage and dead clicks.',
    );
  }
  return parts.join('\n');
}

function replaysSection({ replays }) {
  if (!replays.length) return muted('No session had friction to watch.');
  return list(
    replays.map((replay) => {
      const what = [
        replay.rage ? plural(replay.rage, 'rage click') : null,
        replay.dead ? plural(replay.dead, 'dead click') : null,
        replay.errors ? plural(replay.errors, 'error') : null,
        replay.walls ? plural(replay.walls, 'upgrade wall') : null,
        replay.failedFlows ? plural(replay.failedFlows, 'failed flow') : null,
      ]
        .filter(Boolean)
        .join(', ');
      const where = [replay.day ? formatDay(replay.day) : null, replay.page]
        .filter(Boolean)
        .join(' · ');
      return `${link(replay.url, 'Watch')} ${escapeHtml(where)}${detail(`— ${what}`)}`;
    }),
  );
}

function notUsedSection(featureUse) {
  const rows = (featureUse ?? []).map(({ label: name, count }) => {
    const value = count === null ? "Couldn't read" : count === 0 ? 'Never' : `Yes (${n(count)})`;
    const style = count === 0 ? 'font-weight:600;' : count === null ? MUTED : '';
    return `<tr><td style="padding:4px 12px 4px 0;vertical-align:top;${TEXT}${MUTED}white-space:nowrap;">${escapeHtml(name)}</td><td style="padding:4px 0;vertical-align:top;${TEXT}${style}">${escapeHtml(value)}</td></tr>`;
  });
  if (!rows.length) return muted("Couldn't read what the workspace used.");
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
${rows.join('\n')}
</table>`;
}

/**
 * @param {{ subject: string, activity: object, featureUse: object[], ai: object }} input
 *   `subject` the first e-mail's; `activity` summariseActivity's answer, or
 *   { ok: false } when PostHog didn't answer
 * @returns {{ subject: string, html: string }}
 */
export function buildCancelAnalysisEmail({ subject, activity, featureUse, ai }) {
  const posthog = activity?.ok
    ? `${heading(`Day by day (last ${activity.days} days, UTC)`)}
${daysSection(activity)}
${heading('Where they got stuck')}
${stuckSection(activity)}
${heading('Replays to watch')}
${replaysSection(activity)}`
    : `${heading('Day by day')}
${muted("PostHog didn't answer, so there is no activity.")}`;

  const html = `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1C1A17;">
<p style="margin:0 0 8px;font-size:16px;font-weight:600;">What they did before this</p>
${analysisSection(ai)}
${posthog}
${heading('Not used')}
${notUsedSection(featureUse)}
${
  activity?.ok
    ? `<p style="margin:16px 0 0;${TEXT}">${link(activity.personUrl, 'Open their PostHog profile and replays')}</p>\n`
    : ''
}<p style="margin:16px 0 0;font-size:12px;${MUTED}">For the team only: a reply to this e-mail doesn't go to the customer.</p>
</body></html>`;

  return { subject: `Re: ${subject}`, html };
}
