/**
 * Concrete library tasks: a title that names what the task is about, and a
 * spec (Where, How, Done when), written from what the action already carries.
 *
 * A library task's message names a count ("Optimize content for 1
 * competitor"), and its details only say how it is checked. This reads the
 * action's payload and its signals' evidence (task-writer/evidence.js, the
 * same read the task writer gives its model) and fills in the prompt, page,
 * competitor and platform they name. Templated text only: no model call. A
 * task with nothing concrete to name gets null, and keeps its message.
 *
 * English, as a written task's title and details are stored: they are the
 * action's own words, which a person may then edit.
 */

import { buildEvidence, platformLabel } from '../task-writer/evidence.js';
import { onePage } from './templates.js';

const str = (value) => (typeof value === 'string' ? value.trim() : '');
const list = (value) => (Array.isArray(value) ? value : []);
const unique = (values) => {
  const seen = new Set();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** A prompt as a title quotes it: its first 80 characters. */
const MAX_PROMPT = 80;
export const quote = (text) =>
  `“${text.length > MAX_PROMPT ? `${text.slice(0, MAX_PROMPT - 1).trimEnd()}…` : text}”`;

/** "/subscriptions" for a page's full URL; the host for its home page. */
export function pageName(url) {
  try {
    const { hostname, pathname } = new URL(url);
    return pathname && pathname !== '/' ? pathname.replace(/\/$/, '') : hostname;
  } catch {
    return str(url);
  }
}

/** "ChatGPT and Gemini", "ChatGPT, Gemini and Perplexity". */
const and = (items) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

const targetLabel = (target) =>
  typeof target === 'string' ? str(target) : str(target?.label) || str(target?.text);

/**
 * What an action's tasks can name: its prompts (the first, and how many
 * more), competitor, platforms, page, topic and the domains cited, from its
 * payload and its signals' evidence.
 */
export function actionFacts(payload = {}, signals = []) {
  const evidence = buildEvidence(list(signals));
  const entity = str(payload.targetEntity);
  const labels = list(payload.targets).map(targetLabel).filter(Boolean);
  const named = (kind) => (entity === kind ? labels : []);

  const prompts = unique([
    str(payload.leadPrompt?.text),
    ...evidence.prompts.map((p) => p.text),
    ...named('prompts'),
    str(payload.promptText),
  ]);
  const promptCount = Math.max(
    prompts.length,
    entity === 'prompts' ? Number(payload.targetCount) || 0 : 0,
  );
  const competitors = unique([
    ...list(payload.competitorNames).map(str),
    str(payload.competitorName),
    ...named('competitors'),
    ...evidence.competitors.map((c) => c.name),
  ]);
  const platforms = unique(
    [
      str(payload.platform),
      ...named('platforms'),
      ...evidence.prompts.flatMap((p) => [...p.platforms]),
    ]
      .filter(Boolean)
      .map(platformLabel),
  );
  const rival = evidence.competitors[0];
  const rivalPage = rival ? ([...rival.pageEvents.values()][0]?.url ?? null) : null;
  const creates =
    payload.contentExists === false ||
    list(payload.assets).some((asset) => asset?.decision === 'create');
  return {
    prompt: prompts[0] ?? null,
    more: Math.max(0, promptCount - 1),
    competitor: competitors[0] ?? null,
    rivalPage,
    platforms: platforms.slice(0, 3),
    page: onePage(payload) ?? (evidence.pages.length === 1 ? evidence.pages[0].url : null),
    topic: str(payload.topicName) || named('topics')[0] || evidence.topics[0]?.name || null,
    domains: evidence.domains.map((d) => d.domain).slice(0, 3),
    creates,
    work: payload.source === 'content_opportunity' ? str(payload.title) || null : null,
  };
}

/** What a task is about: the first prompt (and how many more), else the topic. */
function subjectOf(f) {
  if (f.prompt) {
    const more = f.more ? ` and ${f.more} related prompt${f.more === 1 ? '' : 's'}` : '';
    return `${quote(f.prompt)}${more}`;
  }
  return f.topic ? quote(f.topic) : null;
}

/**
 * Each library task's title and spec, given the facts and their subject.
 * Null when there is nothing concrete to name: the task keeps its message.
 */
const BUILDERS = {
  analyze_competitor_visibility: (f, s, ctx) => {
    if (!f.competitor || !s) return null;
    return {
      title: `See where ${f.competitor} is named ahead of you on ${s}`,
      where: ctx.answers,
      how: [
        `Open the AI answers to ${quote(f.prompt ?? f.topic)}${ctx.on}`,
        `Mark each answer that names ${f.competitor} and not you`,
        `Note the pages cited next to ${f.competitor}`,
      ],
      doneWhen: `You can list the answers to ${quote(f.prompt ?? f.topic)} that name ${f.competitor} and not you.`,
    };
  },
  analyze_ai_responses: (f, s, ctx) => {
    if (!f.prompt) return null;
    return {
      title: `Read how ${ctx.engines} answer ${s}`,
      where: ctx.answers,
      how: [
        `Open each answer to ${quote(f.prompt)}${ctx.on}`,
        'Note the brands each answer names, in order',
        'Note the pages each answer cites',
      ],
      doneWhen: `You know who each answer to ${quote(f.prompt)} names and which pages it cites.`,
    };
  },
  analyze_competitor_content: (f, s, ctx) => {
    if (!f.competitor || !s) return null;
    const on = quote(f.prompt ?? f.topic);
    return {
      title: f.rivalPage
        ? `Compare ${f.competitor}’s cited page ${pageName(f.rivalPage)} with yours on ${on}`
        : `Compare what ${f.competitor} publishes on ${on} with your page`,
      where: f.rivalPage ?? ctx.answers,
      how: [
        f.rivalPage
          ? `Open ${f.rivalPage}`
          : `Open the pages AI cites for ${f.competitor} on ${quote(f.prompt ?? f.topic)}`,
        'List what it answers that your page does not: facts, comparisons, prices, FAQs',
        'Keep the three points worth adding to your own page',
      ],
      doneWhen: `You have three points ${f.competitor} covers that your page does not.`,
    };
  },
  analyze_citations: (f, s, ctx) => {
    if (!s) return null;
    const cited = f.domains.length ? ` (${and(f.domains)})` : '';
    return {
      title: `List the pages AI cites for ${s}${cited}`,
      where: ctx.answers ?? s,
      how: [
        `Open the citations on the answers to ${s}`,
        'Note which cited pages are yours, a competitor’s or a third party’s',
        'Note what the most cited page covers',
      ],
      doneWhen: 'You know which pages are cited, whose they are, and whether yours is among them.',
    };
  },
  identify_content_gaps: (f, s) => {
    if (!s) return null;
    return {
      title: f.page
        ? `Find what ${pageName(f.page)} is missing to answer ${s}`
        : `Find what your site is missing to answer ${s}`,
      where: f.page ?? s,
      how: [
        `Ask ${quote(f.prompt ?? f.topic)} the way a buyer would, and note the questions inside it`,
        f.page
          ? `Check which of them ${pageName(f.page)} answers`
          : 'Check which your pages answer',
        'List the ones nobody on your site answers yet',
      ],
      doneWhen: `You have a short list of the questions in ${quote(f.prompt ?? f.topic)} your site does not answer.`,
    };
  },
  optimize_content: (f, s) => {
    if (!s && !f.page) return null;
    const page = f.page ? pageName(f.page) : null;
    if (!s) {
      return {
        title: `Update ${page} so AI can quote it`,
        where: f.page,
        how: [
          `Open ${f.page}`,
          'Put a direct, two-sentence answer to the page’s main question at the top',
          'Add a short FAQ with the questions buyers ask about it',
          'Publish the change',
        ],
        doneWhen: `${page} opens with a direct answer and its FAQ is live.`,
      };
    }
    const vs = f.competitor ? [`Say plainly how you compare with ${f.competitor}`] : [];
    return {
      title: page ? `Update ${page} to answer ${s}` : `Update the page that should answer ${s}`,
      where: f.page ?? s,
      how: [
        `Add a direct answer to ${quote(f.prompt ?? f.topic)} in the page’s first paragraph`,
        'Add the facts the cited pages give and yours lacks, as a short FAQ',
        ...vs,
        'Publish the change',
      ],
      doneWhen: `${page ?? 'The page'} answers ${quote(f.prompt ?? f.topic)} in its first paragraph, and the change is live.`,
    };
  },
  refresh_content: (f, s) => {
    if (!f.page) return null;
    const page = pageName(f.page);
    return {
      title: s ? `Refresh ${page} for ${s}` : `Refresh ${page}`,
      where: f.page,
      how: [
        `Open ${f.page}`,
        'Update facts, prices and dates that are out of date',
        s
          ? `Add a direct answer to ${quote(f.prompt ?? f.topic)}`
          : 'Add what changed since it was written',
        'Publish it with a new “updated” date',
      ],
      doneWhen: `${page} shows this year’s facts and a new “updated” date.`,
    };
  },
  create_content_brief: (f, s) => {
    if (!s && !f.work) return null;
    const about = f.work ? quote(f.work) : `a new page answering ${s}`;
    return {
      title: `Brief ${about}`,
      where: s ?? f.work,
      how: [
        `Name the prompt it answers first: ${quote(f.prompt ?? f.topic ?? f.work)}`,
        'List the questions it must answer, from the AI answers and the pages they cite',
        f.competitor
          ? `Note what ${f.competitor}’s pages cover, to cover it better`
          : 'Note the pages it has to beat',
      ],
      doneWhen: 'The brief names the prompt, the questions to answer and the pages to beat.',
    };
  },
  create_content_draft: (f, s) => {
    if (!s && !f.work) return null;
    return {
      title: f.work ? `Draft ${quote(f.work)}` : `Draft a new page answering ${s}`,
      where: s ?? f.work,
      how: [
        'Write from the brief',
        `Answer ${quote(f.prompt ?? f.topic ?? f.work)} in the first paragraph`,
        'Add a short FAQ for the related questions',
      ],
      doneWhen: `A draft answers ${quote(f.prompt ?? f.topic ?? f.work)} in its first paragraph and is ready to publish.`,
    };
  },
  strengthen_entity_content: (f, s) => {
    if (!s) return null;
    return {
      title: `Make your pages say what you offer for ${s}`,
      where: f.page ?? 'Your About and product pages',
      how: [
        `Check how your About and product pages describe what you offer for ${quote(f.prompt ?? f.topic)}`,
        'Use the same brand name, category and claims on every page',
        'Add the facts AI answers repeat about others and leave out about you',
      ],
      doneWhen: `Your About and product pages name what you offer for ${quote(f.prompt ?? f.topic)}, in the same words.`,
    };
  },
  add_internal_links: (f, s) => {
    if (!f.page) return null;
    const page = pageName(f.page);
    return {
      title: `Link to ${page} from related pages`,
      where: f.page,
      how: [
        `Find two or three of your pages about ${s ?? 'the same subject'}`,
        `Add a link to ${page} on each, with words that say what it answers`,
      ],
      doneWhen: `At least two related pages link to ${page}.`,
    };
  },
  publish_content: (f, s) => {
    const page = f.page ? pageName(f.page) : null;
    if (!page && !f.work && !s) return null;
    return {
      title: page
        ? `Publish the update to ${page}`
        : `Publish ${f.work ? quote(f.work) : `the page answering ${s}`}`,
      where: f.page ?? s ?? f.work,
      how: ['Publish the change', 'Open the live page and check the new text is there'],
      doneWhen: page ? `${page} shows the new text live.` : 'The new page is live.',
    };
  },
  validate_ai_visibility: (f, s, ctx) => {
    if (!f.prompt) return null;
    return {
      title: `Check that ${ctx.engines} name you on ${s}`,
      where: ctx.answers,
      how: [
        `After the next runs, open the answers to ${quote(f.prompt)}`,
        'Note on which platforms you are named now',
      ],
      doneWhen: `More answers to ${quote(f.prompt)} name you than when the action opened.`,
    };
  },
  validate_competitive_gap: (f, s, ctx) => {
    if (!f.competitor || !s) return null;
    return {
      title: `Check the gap with ${f.competitor} on ${s}`,
      where: ctx.answers,
      how: [
        `After the next runs, open the answers to ${quote(f.prompt ?? f.topic)}`,
        `Count the answers that name ${f.competitor}, and those that name you`,
      ],
      doneWhen: `You are named in as many answers to ${quote(f.prompt ?? f.topic)} as ${f.competitor}.`,
    };
  },
  validate_platform_visibility: (f, s) => {
    const platform = f.platforms[0];
    if (!platform) return null;
    return {
      title: s
        ? `Check that ${platform} names you on ${s}`
        : `Check that ${platform} names you again`,
      where: s ? `${platform}’s answers to ${quote(f.prompt ?? f.topic)}` : platform,
      how: [`After the next runs, open ${platform}’s answers`, 'Note whether you are named'],
      doneWhen: s
        ? `${platform} names you on ${quote(f.prompt ?? f.topic)} as often as before the drop.`
        : `${platform} names you as often as before the drop.`,
    };
  },
  validate_citations: (f, s, ctx) => {
    if (!f.page || !s) return null;
    const page = pageName(f.page);
    return {
      title: `Check that AI cites ${page} for ${s}`,
      where: ctx.answers,
      how: [`After the next runs, open the citations on the answers to ${s}`, `Look for ${page}`],
      doneWhen: `At least one answer to ${quote(f.prompt ?? f.topic)} cites ${page}.`,
    };
  },
  validate_mentions: (f, s, ctx) => {
    if (!f.prompt) return null;
    return {
      title: `Check that answers to ${s} mention you again`,
      where: ctx.answers,
      how: [
        `After the next runs, open the answers to ${quote(f.prompt)}`,
        'Note whether you are named',
      ],
      doneWhen: `Answers to ${quote(f.prompt)} name you again.`,
    };
  },
  measure_action_outcome: (f, s) => {
    if (!s) return null;
    return {
      title: `Measure the result on ${s}`,
      where: s,
      how: [
        'Wait for two weeks of runs after the change',
        'Compare your visibility on these prompts with when the action opened',
      ],
      doneWhen: 'Your visibility on these prompts is higher than when the action opened.',
    };
  },
  analyze_prompt_gap: (f, s, ctx) => {
    if (!f.prompt) return null;
    return {
      title: `See why you are missing from answers to ${s}`,
      where: ctx.answers,
      how: [
        `Open the answers to ${quote(f.prompt)}${ctx.on}`,
        'Note the brands and pages they name instead of you',
      ],
      doneWhen: `You know who answers to ${quote(f.prompt)} name instead of you, and which pages they cite.`,
    };
  },
  map_prompts_to_content: (f, s) => {
    if (!s) return null;
    return {
      title: `Pick the page that should answer ${s}`,
      where: f.page ?? s,
      how: [
        `Search your site for pages about ${quote(f.prompt ?? f.topic)}`,
        'Pick the one closest to the question, or note that none fits',
      ],
      doneWhen: `One page is chosen to answer ${quote(f.prompt ?? f.topic)}, or a new one is needed.`,
    };
  },
  analyze_visibility_change: (f, s, ctx) => {
    if (!f.prompt) return null;
    return {
      title: `See what changed in answers to ${s}`,
      where: ctx.answers,
      how: [
        `Compare this week’s answers to ${quote(f.prompt)} with last week’s`,
        'Note who was added or dropped, and which pages are now cited',
      ],
      doneWhen: `You can say what changed in the answers to ${quote(f.prompt)}, and why.`,
    };
  },
  analyze_mention_context: (f, s, ctx) => {
    if (!f.prompt) return null;
    return {
      title: `Read the answers to ${s} that stopped naming you`,
      where: ctx.answers,
      how: [
        `Open the answers to ${quote(f.prompt)}${ctx.on}`,
        'Note who is named in your place and which pages they cite',
      ],
      doneWhen: `You know who answers to ${quote(f.prompt)} name in your place.`,
    };
  },
  analyze_platform_gap: (f, s) => {
    const platform = f.platforms[0];
    if (!platform) return null;
    return {
      title: s
        ? `See why ${platform} stopped naming you on ${s}`
        : `See where ${platform} stopped naming you`,
      where: s ? `${platform}’s answers to ${quote(f.prompt ?? f.topic)}` : platform,
      how: [
        `Open ${platform}’s answers${s ? ` to ${quote(f.prompt ?? f.topic)}` : ''}`,
        'Compare them with another platform’s that still names you',
        'Note the pages each one cites',
      ],
      doneWhen: `You know which pages ${platform} cites instead of yours.`,
    };
  },
  identify_target_pages: (f, s) => {
    if (!s) return null;
    return {
      title: f.page
        ? `Confirm ${pageName(f.page)} is the page winning ${s}`
        : `Find your page that is winning ${s}`,
      where: f.page ?? s,
      how: [
        `Open the citations on the answers to ${s}`,
        'Find which of your pages is cited, or closest to being cited',
      ],
      doneWhen: `You have the one page to build on for ${quote(f.prompt ?? f.topic)}.`,
    };
  },
  analyze_winning_pages: (f, s) => {
    if (!s) return null;
    return {
      title: `See what the pages AI cites for ${s} have in common`,
      where: s,
      how: [
        `Open the pages cited on the answers to ${s}`,
        'Note what they share: a direct answer, a list, a table, a date',
      ],
      doneWhen: 'You have the two or three things the cited pages share.',
    };
  },
};

/** The tasks this module can make concrete, for the tests. */
export const CONCRETE_TASKS = Object.freeze(Object.keys(BUILDERS));

/**
 * One library task, concrete: `{ title, where, how, doneWhen }`, or null
 * when the action names nothing it can be about.
 */
export function concreteTask(taskKey, facts) {
  const build = BUILDERS[taskKey];
  if (!build || !facts) return null;
  const subject = subjectOf(facts);
  const ctx = {
    engines: facts.platforms.length ? and(facts.platforms.slice(0, 2)) : 'AI engines',
    on: facts.platforms.length ? ` on ${and(facts.platforms.slice(0, 2))}` : '',
    answers: facts.prompt
      ? `AI answers to ${quote(facts.prompt)}${facts.platforms.length ? ` on ${and(facts.platforms.slice(0, 2))}` : ''}`
      : null,
  };
  const task = build(facts, subject, ctx);
  if (!task?.title) return null;
  return {
    title: task.title,
    where: task.where ?? null,
    how: task.how.filter(Boolean),
    doneWhen: task.doneWhen ?? null,
  };
}
