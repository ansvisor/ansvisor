/**
 * Record the brief eval (CE-EVAL-001, content-brief-eval.js): for each case
 * in src/lib/__fixtures__/brief-eval/cases.js, the brief Rebuild outline
 * writes (the brief's own model, prompt and shaping), the checks anyone can
 * repeat, and a judge model's scores on the nine criteria, for
 * content-brief-eval.test.js to read on every test run.
 *
 * Run from server/, with .env holding the providers' keys for both models
 * (the brief's is IMPROVE_SUGGESTION_MODEL, else DEFAULT_SUGGESTION_MODEL,
 * else google/gemini-3-flash-preview; the judge's BRIEF_EVAL_JUDGE_MODEL,
 * else anthropic/claude-haiku-4-5) and the Supabase keys the modules load
 * with (nothing is read or written there):
 *   node src/scripts/eval-brief.js [count]
 *   count defaults to every case: two calls each, the brief and its judge.
 *
 * Writes src/lib/__fixtures__/brief-eval/recorded.json, only when at least
 * one case was answered, and prints the sums. Reads and writes no database,
 * charges no workspace's AI usage, never prints a key, and isn't run in CI:
 * the answers it keeps are the models' of the day, for a person to record
 * again when the brief's prompt or the models change (the test skips a
 * record made under another prompt). About a dollar at today's prices.
 */
import 'dotenv/config';
import { writeFileSync } from 'fs';
import { generateObject } from 'ai';
import { CASES } from '../lib/__fixtures__/brief-eval/cases.js';
import { resolveModel } from '../lib/ai-provider.js';
import {
  SYSTEM_PROMPT,
  buildBriefPrompt,
  contentBriefModelId,
  outlineSchema,
  shapeBrief,
} from '../lib/content-brief.js';
import {
  JUDGE_SYSTEM_PROMPT,
  briefChecks,
  briefEvalJudgeModelId,
  buildJudgePrompt,
  judgeSchema,
  passesGate,
  promptVersion,
  readJudged,
  summarize,
} from '../lib/content-brief-eval.js';

const count = Math.max(
  1,
  Math.min(CASES.length, Number.parseInt(process.argv[2] ?? `${CASES.length}`, 10) || CASES.length),
);

const modelId = contentBriefModelId();
const judgeModelId = briefEvalJudgeModelId();
const model = resolveModel(modelId);
const judge = resolveModel(judgeModelId);
const recorded = {};
const started = Date.now();

for (const c of CASES.slice(0, count)) {
  try {
    const written = await generateObject({
      model,
      schema: outlineSchema,
      system: SYSTEM_PROMPT,
      prompt: buildBriefPrompt(c),
    });
    const brief = shapeBrief(written.object, c);
    const checks = briefChecks(brief, c);
    const graded = await generateObject({
      model: judge,
      schema: judgeSchema,
      system: JUDGE_SYSTEM_PROMPT,
      prompt: buildJudgePrompt(c, brief),
      temperature: 0,
    });
    recorded[c.id] = {
      brief,
      usage: written.usage,
      judgeUsage: graded.usage,
      checks,
      judged: readJudged(graded.object, brief),
    };
    const gate = passesGate(checks) ? 'passes' : 'FAILS';
    console.log(`${c.id}: ${brief.outline.length} sections, gate ${gate}`);
  } catch (err) {
    console.error(`${c.id}: failed (${err?.message ?? err})`);
  }
}

if (!Object.keys(recorded).length) {
  console.error('No case was answered: recorded.json is left as it was.');
  process.exit(1);
}
writeFileSync(
  new URL('../lib/__fixtures__/brief-eval/recorded.json', import.meta.url),
  `${JSON.stringify(
    {
      model: modelId,
      judgeModel: judgeModelId,
      promptVersion: promptVersion(CASES[0]),
      recordedAt: new Date().toISOString(),
      cases: recorded,
    },
    null,
    2,
  )}\n`,
);
console.log(JSON.stringify(summarize(recorded), null, 2));
console.log(
  `Recorded ${Object.keys(recorded).length} of ${count} cases with ${modelId}, judged by ${judgeModelId}, in ${((Date.now() - started) / 1000).toFixed(0)} s.`,
);
