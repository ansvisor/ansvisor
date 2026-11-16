import {
  classifyProviderError,
  isKeyFailureClass,
  needsDataRetention,
  type KeyFailureClass,
} from '@/lib/agent/key-errors';
import type { AiProvider } from '@/lib/agent/providers';
import type { ChatModels } from './engine-model';
import type { ChatKeySource } from './key';

/**
 * A run's model call that failed on the workspace's own key, or a provider
 * that didn't answer (AGENT-OWN-KEY §5.2): the engine ends the run with its
 * own code and words rather than "Something went wrong".
 */

/** Why the run stopped on the workspace's own key, as its progress keeps it. */
export interface RunKeyFailure {
  class: KeyFailureClass;
  provider: AiProvider;
  /** The provider's HTTP status, when it answered. */
  status: number | null;
  /** The model the key couldn't reach (`model`), as the catalog names it. */
  model: string | null;
}

/** The own key failed: the run ends `own_key`, with no second call on the same key. */
export class KeyFailureError extends Error {
  readonly failure: RunKeyFailure;

  constructor(failure: RunKeyFailure) {
    super(`The ${failure.provider} key failed: ${failure.class}`);
    this.name = 'KeyFailureError';
    this.failure = failure;
  }
}

/** The provider didn't answer after the SDK's retries: the run ends `provider_down`. */
export class ProviderDownError extends Error {
  readonly provider: AiProvider;

  constructor(provider: AiProvider, cause: unknown) {
    super(`${provider} didn't answer`, { cause });
    this.name = 'ProviderDownError';
    this.provider = provider;
  }
}

/**
 * The model turned the request down (Claude's stop_reason "refusal", for a
 * model whose entry says so: OfferedModel.refusalStop). The run ends with
 * plain words; the same request would be turned down again.
 */
export class ModelRefusalError extends Error {
  /** The model's catalog id, as the AI budget prices it. */
  readonly model: string;

  constructor(model: string) {
    super(`${model} turned the request down`);
    this.name = 'ModelRefusalError';
    this.model = model;
  }
}

/**
 * The model needs 30-day data retention and the key's provider account has
 * zero data retention (a 400 before any output, needsDataRetention): the run
 * ends with plain words, and the key isn't marked failing, as it runs every
 * other model.
 */
export class ModelRetentionError extends Error {
  readonly model: string;
  /** Whose key it ran on: the words differ for the workspace's own. */
  readonly source: ChatKeySource;

  constructor(model: string, source: ChatKeySource, cause: unknown) {
    super(`${model} needs 30-day data retention on the provider account`, { cause });
    this.name = 'ModelRetentionError';
    this.model = model;
    this.source = source;
  }
}

/** A failure that ends the run at once: the next step would meet the same. */
export function endsRun(
  failure: unknown,
): failure is KeyFailureError | ModelRefusalError | ModelRetentionError {
  return (
    failure instanceof KeyFailureError ||
    failure instanceof ModelRefusalError ||
    failure instanceof ModelRetentionError
  );
}

/** The model's name without its provider, as `openai/gpt-5.5` is `gpt-5.5`. */
const modelName = (budgetModel: string) => budgetModel.split('/').slice(1).join('/') || budgetModel;

/**
 * What a failed model call means for the run: the model's refusal, as it
 * was thrown; a model the key's account can't run for lack of data
 * retention; a key class on the workspace's own key (Ansvisor's key failing
 * is ours, not the workspace's to fix); a provider that didn't answer; or
 * null for anything else (the run fails as before).
 */
export function stepFailure(
  models: Pick<ChatModels, 'source' | 'provider'>,
  budgetModel: string,
  error: unknown,
): KeyFailureError | ProviderDownError | ModelRefusalError | ModelRetentionError | null {
  if (error instanceof ModelRefusalError) return error;
  if (needsDataRetention(error)) return new ModelRetentionError(budgetModel, models.source, error);
  const verdict = classifyProviderError(models.provider, error);
  if (isKeyFailureClass(verdict.class)) {
    if (models.source !== 'own') return null;
    return new KeyFailureError({
      class: verdict.class,
      provider: models.provider,
      status: verdict.status,
      model: verdict.class === 'model' ? modelName(budgetModel) : null,
    });
  }
  if (verdict.class === 'transient') return new ProviderDownError(models.provider, error);
  return null;
}
