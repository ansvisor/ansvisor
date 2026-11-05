/**
 * The models Chat's model menu offers (CHAT-16 §A, W4-01): Auto, and the
 * models that passed Chat's tests on its rules (structured answers, the
 * guardrails, no made-up numbers) in a real run (Wave 4 decision 1 B; owner,
 * 2026-11-02). Each model Chat may run is listed with `tested`: only a tested
 * one is offered in the menu, asked of the price catalog, or run by the
 * engine; a chat or an agent that picked one not tested runs Auto. At launch
 * that was Haiku 5.5 and Sonnet 5.5, which Auto runs already; Opus 5.5 since
 * it passed the test set twice in a row (2026-11-03). Each has its id
 * in OpenRouter's catalog, which the API server prices and labels by
 * (lib/model-menu.js), and its id in its provider's own API. Shared by the
 * browser and the server: no keys here.
 */

/** What a run's `model` is when the person picked nothing: Haiku reads, Sonnet writes. */
export const AUTO_MODEL = 'auto';

/**
 * How an offered model is called: Anthropic's own API (on Ansvisor's key or
 * the workspace's own Anthropic key), or OpenRouter (Ansvisor's
 * OPENROUTER_API_KEY; offered only where it is set). None of OpenRouter's is
 * offered yet.
 */
export type OfferedModelProvider = 'anthropic' | 'openrouter';

export interface OfferedModel {
  /** The catalog's id ("anthropic/claude-sonnet-5.5"): what a run keeps as its model. */
  id: string;
  /** The provider's own API id ("claude-sonnet-5-5"); OpenRouter's is its catalog id. */
  api: string;
  provider: OfferedModelProvider;
  /** Its name on the composer's model button, a product name ("Sonnet 5.5"). */
  label: string;
  /**
   * It passed Chat's test set in a real run: only then is it offered and run.
   * Set to true in the same pull request that records its passing run.
   */
  tested: boolean;
}

/** Every model Chat may run once it is tested, tested or not. */
export const CHAT_MODELS: readonly OfferedModel[] = [
  {
    id: 'anthropic/claude-haiku-5.5',
    api: 'claude-haiku-5-5',
    provider: 'anthropic',
    label: 'Haiku 5.5',
    tested: true,
  },
  {
    id: 'anthropic/claude-sonnet-5.5',
    api: 'claude-sonnet-5-5',
    provider: 'anthropic',
    label: 'Sonnet 5.5',
    tested: true,
  },
  // Passed the whole test set twice in a row on Anthropic's API, cache on (2026-11-03, W4-35).
  // The test set is lib/chat/testing/model-eval.ts, run by model-eval.test.ts.
  {
    id: 'anthropic/claude-opus-5.5',
    api: 'claude-opus-5-5',
    provider: 'anthropic',
    label: 'Opus 5.5',
    tested: true,
  },
  // The latest of OpenAI, Google and DeepSeek, through OpenRouter (W4-35).
  {
    id: 'openai/gpt-6.1-sol',
    api: 'openai/gpt-6.1-sol',
    provider: 'openrouter',
    label: 'GPT-6.1 Sol',
    tested: false,
  },
  {
    id: 'openai/gpt-6.1-terra',
    api: 'openai/gpt-6.1-terra',
    provider: 'openrouter',
    label: 'GPT-6.1 Terra',
    tested: false,
  },
  // OpenAI's smallest and cheapest (owner, 2026-11-03).
  {
    id: 'openai/gpt-6-luna',
    api: 'openai/gpt-6-luna',
    provider: 'openrouter',
    label: 'GPT-6 Luna',
    tested: false,
  },
  {
    id: 'google/gemini-4-argon',
    api: 'google/gemini-4-argon',
    provider: 'openrouter',
    label: 'Gemini 4 Argon',
    tested: false,
  },
  {
    id: 'google/gemini-3.8-flash',
    api: 'google/gemini-3.8-flash',
    provider: 'openrouter',
    label: 'Gemini 3.8 Flash',
    tested: false,
  },
  // Google's smallest and cheapest (owner, 2026-11-03).
  {
    id: 'google/gemini-3.5-flash-lite',
    api: 'google/gemini-3.5-flash-lite',
    provider: 'openrouter',
    label: 'Gemini 3.5 Flash Lite',
    tested: false,
  },
  {
    id: 'deepseek/deepseek-v4.1-flash',
    api: 'deepseek/deepseek-v4.1-flash',
    provider: 'openrouter',
    label: 'DeepSeek V4.1 Flash',
    tested: false,
  },
];

/** The models the menu offers, the catalog is asked for and the engine runs: the tested ones. */
export const OFFERED_MODELS: readonly OfferedModel[] = CHAT_MODELS.filter((model) => model.tested);

/** How hard a run works (CHAT-16 item 12): Normal, High, Max; higher uses the limit faster. */
export const CHAT_EFFORTS = ['normal', 'high', 'max'] as const;
export type ChatModelEffort = (typeof CHAT_EFFORTS)[number];

/** A run's model and effort, as the composer sends them and a chat keeps them. */
export interface ChatModelChoice {
  model: string;
  effort: ChatModelEffort;
}

export const AUTO_CHOICE: ChatModelChoice = { model: AUTO_MODEL, effort: 'normal' };

/**
 * Whether the person may pick a model and effort (Wave 4 decision 2 B):
 * from Starter up. The free trial runs Auto at Normal only: its AI limit is
 * small, and one long run at Max on a costly model could use it up. Self-hosted: open.
 */
export function modelChoiceOpen(plan: { selfHosted: boolean; isTrial: boolean }): boolean {
  return plan.selfHosted || !plan.isTrial;
}

/**
 * The choice a run starts with: what was asked when the plan lets the
 * person choose and the model is offered, else Auto at Normal.
 */
export function runChoiceOf(
  asked: { model?: string | null; effort?: string | null },
  open: boolean,
): ChatModelChoice {
  if (!open) return AUTO_CHOICE;
  const model = isChatModelChoice(asked.model) ? asked.model : AUTO_MODEL;
  const effort = (CHAT_EFFORTS as readonly string[]).includes(asked.effort ?? '')
    ? (asked.effort as ChatModelEffort)
    : 'normal';
  return { model, effort };
}

/** An offered (tested) model by its catalog id; null for Auto, one not tested, or one not listed. */
export function offeredModel(id: string | null | undefined): OfferedModel | null {
  return OFFERED_MODELS.find((model) => model.id === id) ?? null;
}

/** Whether a value is a model a run may ask for: Auto or an offered model. */
export function isChatModelChoice(value: unknown): value is string {
  return value === AUTO_MODEL || (typeof value === 'string' && offeredModel(value) !== null);
}

/** A model id as the catalog writes it ("provider/model"), offered or not. */
export function isCatalogId(value: unknown): value is string {
  return (
    typeof value === 'string' && /^[A-Za-z0-9._~:-]{1,100}\/[A-Za-z0-9._~:-]{1,100}$/.test(value)
  );
}

/** The choice of a chat's latest run, as runChoiceOf reads it; Auto at Normal with none. */
export function latestChoice(
  runs: readonly { model?: string | null; effort?: string | null; created_at?: string | null }[],
): ChatModelChoice {
  const latest = [...runs].sort((a, b) =>
    String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')),
  )[0];
  return latest ? runChoiceOf(latest, true) : AUTO_CHOICE;
}
