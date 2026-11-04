import logger from '../logger.js';
import { pollScraperResult, submitScraperTask } from '../cloro-scraper.js';
import { loadSupportedCountries, supportsCountry } from '../cloro-countries.js';

/**
 * A report card's questions asked in the four engines (REPORT-CARD §1),
 * through the tracking's own provider (Cloro), from the target country: one
 * answer per question and engine, 100 at most. An engine that doesn't answer
 * from the country is left out; a question Google gives no AI Overview for
 * is no answer, not a failure. A few tasks run at a time.
 */

/** The engines a card asks, in the order it lists them (web lib/report-card/payload.ts). */
export const REPORT_CARD_ENGINES = ['chatgpt-web', 'gemini-web', 'google-aio', 'google-aimode'];

/** Tasks in flight at once. */
const IN_FLIGHT = 12;
/** How long one answer may take. */
const MAX_WAIT_MS = 15 * 60 * 1000;

/** Why a task wasn't asked: the run's deadline had passed. */
export const PAST_DEADLINE = 'The run passed its deadline';

/** Runs `jobs` with at most `limit` at a time, in order; each job's result or error is kept. */
async function pool(jobs, limit) {
  const results = new Array(jobs.length);
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const i = next;
      next += 1;
      try {
        results[i] = { ok: true, value: await jobs[i]() };
      } catch (err) {
        results[i] = { ok: false, error: err };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return results;
}

/** Whether an error is Google showing no AI Overview for the question: no answer to count. */
const noOverview = (err) => /did not return an AI Overview/i.test(String(err?.message ?? ''));

/**
 * The answers: one row per question and engine asked, with the answer's
 * text and citations, or why there is none.
 *
 * @param {{ text: string }[]} questions
 * @param {string} country ISO 3166-1 alpha-2
 * @param {{ deadline?: number }} [opts] - `deadline` (epoch ms): no task is
 *   submitted after it, and none is waited for past it, so a run ends in
 *   time (queue.js RUN_DEADLINE_MS); those left are failed, unpaid.
 * @returns {Promise<{ engines: string[], tasks: number, answers: { question: number, engine: string, text: string|null, citations: { url: string }[], missing: 'no_answer'|'failed'|null }[] }>}
 */
export async function askEngines(
  questions,
  country,
  {
    submit = submitScraperTask,
    poll = pollScraperResult,
    supported = null,
    inFlight = IN_FLIGHT,
    maxWaitMs = MAX_WAIT_MS,
    deadline = Infinity,
    clock = Date.now,
  } = {},
) {
  const countries = supported ?? (await loadSupportedCountries().catch(() => new Map()));
  const engines = REPORT_CARD_ENGINES.filter((engine) =>
    supportsCountry(countries, engine, country),
  );
  const jobs = [];
  for (const engine of engines) {
    questions.forEach((question, index) => {
      jobs.push(async () => {
        if (clock() >= deadline) throw new Error(PAST_DEADLINE);
        const { taskId } = await submit(question.text, engine, country);
        try {
          const left = Math.max(deadline - clock(), 0);
          const answer = await poll(taskId, engine, { maxWaitMs: Math.min(maxWaitMs, left) });
          return {
            question: index,
            engine,
            text: answer.text ?? '',
            citations: answer.citations ?? [],
          };
        } catch (err) {
          if (noOverview(err)) return { question: index, engine, missing: 'no_answer' };
          throw Object.assign(err, { submitted: true });
        }
      });
    });
  }
  const results = await pool(jobs, inFlight);
  let tasks = 0;
  const answers = results.map((result, i) => {
    const engine = engines[Math.floor(i / questions.length)];
    const question = i % questions.length;
    if (result.ok) {
      tasks += 1;
      return { text: null, citations: [], missing: null, ...result.value };
    }
    if (result.error?.submitted) tasks += 1;
    logger.warn({ engine, err: result.error?.message }, '[report-card] an engine did not answer');
    return { question, engine, text: null, citations: [], missing: 'failed' };
  });
  return { engines, tasks, answers };
}
