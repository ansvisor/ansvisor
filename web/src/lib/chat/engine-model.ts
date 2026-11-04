import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';
import { AGENT_PROVIDER_OPTIONS, buildAgentModel } from '@/lib/agent/model';
import { chatModelId, type AiProvider } from '@/lib/agent/providers';
import { resolveChatModelKey, resolvePickedModelKey, type ChatKeySource } from './key';
import { ownKeyFailure } from './key-health';
import {
  AUTO_CHOICE,
  AUTO_MODEL,
  offeredModel,
  type ChatModelChoice as RunModelChoice,
  type ChatModelEffort,
  type OfferedModel,
} from './models';

/**
 * The models a Chat run calls (CHAT-16 items 5, 12 and 23; W4-03). Auto, the
 * default: Claude Haiku 5.5 reads (picks and runs the reads), Claude Sonnet
 * 5.5 writes (the answer and any change). A model picked in the composer's
 * menu (lib/chat/models.ts) does both: a Claude model on Ansvisor's key or
 * the workspace's own Anthropic key keeps the two phases; a model through
 * OpenRouter (none offered yet) runs in one phase on OPENROUTER_API_KEY, and
 * without that key the run takes Auto. On another provider's own key that
 * key's model does both, in one phase, whatever was picked. The effort
 * (Normal, High, Max) is the provider's own setting, and a larger output
 * allowance for the thinking it brings. The key comes from key.ts. Server
 * only.
 *
 * Claude 5.5's Messages API (as #1743 found for the Content Editor):
 *   - no temperature, top_p or top_k: it turns sampling settings away, so
 *     none is ever passed;
 *   - no forced tool_choice: Sonnet 5.5 answers a forced one with a 400, so
 *     tools are always `auto` and a structured answer uses native structured
 *     output (output_config.format), never the SDK's forced "json" tool;
 *   - max_tokens always sent: the SDK doesn't know 5.5 and would send 4,096,
 *     and 5.5's thinking, on by default, counts toward it.
 */

/** Which half of a run a model step is: reading the data, or writing the answer and changes. */
export type ChatPhase = 'read' | 'write';

/** Claude Haiku 5.5: the API's id, and the price catalog's (C1, server model-prices.js AUTO_MIX). */
export const AUTO_READ_MODEL = { api: 'claude-haiku-5-5', catalog: 'anthropic/claude-haiku-5.5' };
/** Claude Sonnet 5.5. */
export const AUTO_WRITE_MODEL = {
  api: 'claude-sonnet-5-5',
  catalog: 'anthropic/claude-sonnet-5.5',
};

/** A reading step's most output tokens, thinking included: it picks reads, it doesn't write. */
export const READ_MAX_OUTPUT_TOKENS = 8_000;
/** A writing step's: the answer, or a page's draft. */
export const WRITE_MAX_OUTPUT_TOKENS = 16_000;

type ProviderOptions = Record<string, Record<string, string | number | boolean | null>>;

/** One step's model and how it is called. */
export interface ChatModelChoice {
  model: LanguageModel;
  /** The id the AI budget prices it by ("anthropic/claude-sonnet-5.5"). */
  budgetModel: string;
  maxOutputTokens: number;
  /** Per provider; for Claude, native structured output. Never sampling settings. */
  providerOptions: ProviderOptions;
  /** A first-party Claude model: the read phase ends with a structured answer. */
  claude: boolean;
}

export interface ChatModels {
  /** Whose key the steps run on: the budget meters Ansvisor's. */
  source: ChatKeySource;
  /** The model the run uses: 'auto' or an offered model's catalog id (W4-03). */
  model: string;
  /** The key's provider, for its errors' words (AGENT-OWN-KEY §5.2). */
  provider: AiProvider;
  /**
   * The workspace's own key was marked failing when the run started
   * (00440): the run's first answered call marks it working again.
   */
  keyFailing: boolean;
  /** `auto`: Haiku reads, Sonnet writes; `single`: one model does both, in one phase. */
  phases: 'auto' | 'single';
  pick(phase: ChatPhase): ChatModelChoice;
}

/** Claude's call settings: native structured output when a step asks for JSON. */
const CLAUDE_OPTIONS: ProviderOptions = {
  anthropic: { structuredOutputMode: 'outputFormat' },
};

/** How much more a step may write at each effort, its thinking included. */
export const EFFORT_OUTPUT_SCALE: Readonly<Record<ChatModelEffort, number>> = {
  normal: 1,
  high: 1.5,
  max: 2,
};

/**
 * Claude's effort setting for each of ours (output_config.effort): Normal
 * leaves the model's own default (medium on Haiku 5.5 and Opus 5.5, high on
 * Sonnet 5.5); High is one level up from it; Max is max.
 */
export function claudeEffort(
  api: string,
  effort: ChatModelEffort,
): 'high' | 'xhigh' | 'max' | undefined {
  if (effort === 'normal') return undefined;
  if (effort === 'max') return 'max';
  return api.startsWith('claude-sonnet-') ? 'xhigh' : 'high';
}

/** One Claude model's step: its id, its price's id, its output allowance and settings. */
function claudeStep(
  anthropic: ReturnType<typeof createAnthropic>,
  model: { api: string; catalog: string },
  maxOutputTokens: number,
  effort: ChatModelEffort,
): ChatModelChoice {
  const level = claudeEffort(model.api, effort);
  return {
    model: anthropic(model.api),
    budgetModel: model.catalog,
    maxOutputTokens: Math.round(maxOutputTokens * EFFORT_OUTPUT_SCALE[effort]),
    providerOptions: level
      ? { anthropic: { ...CLAUDE_OPTIONS.anthropic, effort: level } }
      : CLAUDE_OPTIONS,
    claude: true,
  };
}

/** Auto on an Anthropic key: Haiku 5.5 reads, Sonnet 5.5 writes. */
export function autoModels(
  apiKey: string,
  source: ChatKeySource,
  effort: ChatModelEffort = 'normal',
): ChatModels {
  const anthropic = createAnthropic({ apiKey });
  const read = claudeStep(anthropic, AUTO_READ_MODEL, READ_MAX_OUTPUT_TOKENS, effort);
  const write = claudeStep(anthropic, AUTO_WRITE_MODEL, WRITE_MAX_OUTPUT_TOKENS, effort);
  return {
    source,
    model: AUTO_MODEL,
    provider: 'anthropic',
    keyFailing: false,
    phases: 'auto',
    pick: (phase) => (phase === 'read' ? read : write),
  };
}

/** A Claude model picked in the menu, on an Anthropic key: it reads and writes, two phases. */
export function pickedClaudeModels(
  apiKey: string,
  source: ChatKeySource,
  picked: OfferedModel,
  effort: ChatModelEffort = 'normal',
): ChatModels {
  const anthropic = createAnthropic({ apiKey });
  const model = { api: picked.api, catalog: picked.id };
  const read = claudeStep(anthropic, model, READ_MAX_OUTPUT_TOKENS, effort);
  const write = claudeStep(anthropic, model, WRITE_MAX_OUTPUT_TOKENS, effort);
  return {
    source,
    model: picked.id,
    provider: 'anthropic',
    keyFailing: false,
    phases: 'auto',
    pick: (phase) => (phase === 'read' ? read : write),
  };
}

/**
 * A model picked through OpenRouter, on Ansvisor's OpenRouter key: one
 * model does both, in one phase, as on another provider's own key. Its
 * effort is OpenRouter's reasoning effort.
 */
export function openRouterModels(
  apiKey: string,
  picked: OfferedModel,
  effort: ChatModelEffort = 'normal',
  source: ChatKeySource = 'ansvisor',
): ChatModels {
  const single: ChatModelChoice = {
    model: buildAgentModel({ provider: 'openrouter', apiKey, settings: { model: picked.api } }),
    budgetModel: picked.id,
    maxOutputTokens: Math.round(WRITE_MAX_OUTPUT_TOKENS * EFFORT_OUTPUT_SCALE[effort]),
    providerOptions:
      effort === 'normal'
        ? AGENT_PROVIDER_OPTIONS
        : { ...AGENT_PROVIDER_OPTIONS, openai: { store: false, reasoningEffort: 'high' } },
    claude: false,
  };
  return {
    source,
    model: picked.id,
    provider: 'openrouter',
    keyFailing: false,
    phases: 'single',
    pick: () => single,
  };
}

/**
 * The run's models, from the key it runs on (resolveChatModelKey) and the
 * model and effort it was started with (already checked against the plan,
 * runChoiceOf); null when the workspace has no key Chat may use. Throws
 * OwnKeyUnreadableError when the workspace's own key can't be read. On the
 * own key, its health is read once here (a read that fails reads as
 * working).
 */
export async function resolveChatModels(
  organizationId: string,
  choice: RunModelChoice = AUTO_CHOICE,
  { ansvisorOnly = false }: { ansvisorOnly?: boolean } = {},
): Promise<ChatModels | null> {
  const picked = offeredModel(choice.model);
  if (picked) {
    // Each provider's own key first, then the own OpenRouter key, then Ansvisor's (W4-06).
    const pickedKey = await resolvePickedModelKey(organizationId, picked.provider, {
      ansvisorOnly,
    });
    if (pickedKey) {
      const failing =
        pickedKey.source === 'own' ? await ownKeyFailure(organizationId).catch(() => null) : null;
      const keyFailing = failing?.provider === pickedKey.config.provider;
      if (pickedKey.config.provider === 'anthropic') {
        return {
          ...pickedClaudeModels(pickedKey.config.apiKey, pickedKey.source, picked, choice.effort),
          keyFailing,
        };
      }
      // OpenRouter runs the model by its catalog id.
      return {
        ...openRouterModels(
          pickedKey.config.apiKey,
          { ...picked, api: picked.id },
          choice.effort,
          pickedKey.source,
        ),
        keyFailing,
      };
    }
  }
  const key = await resolveChatModelKey(organizationId, { ansvisorOnly });
  if (!key) return null;
  const keyFailing =
    key.source === 'own' && (await ownKeyFailure(organizationId).catch(() => null)) !== null;
  if (key.config.provider === 'anthropic') {
    return { ...autoModels(key.config.apiKey, key.source, choice.effort), keyFailing };
  }
  // Another provider's own key: its model, as Settings › AI Providers names it, does both.
  const single: ChatModelChoice = {
    model: buildAgentModel(key.config),
    budgetModel: `${key.config.provider}/${chatModelId(key.config.provider, key.config.settings)}`,
    maxOutputTokens: WRITE_MAX_OUTPUT_TOKENS,
    providerOptions: AGENT_PROVIDER_OPTIONS,
    claude: false,
  };
  return {
    source: key.source,
    model: single.budgetModel,
    provider: key.config.provider,
    keyFailing,
    phases: 'single',
    pick: () => single,
  };
}

/**
 * A step's prompt in tokens, counted up (about 3 characters to a token, where
 * English averages 4): the budget's hold assumes the most it could be.
 */
export function estimateInputTokens(parts: readonly unknown[]): number {
  let chars = 0;
  for (const part of parts) {
    chars += typeof part === 'string' ? part.length : (JSON.stringify(part ?? null)?.length ?? 0);
  }
  return Math.ceil(chars / 3);
}
