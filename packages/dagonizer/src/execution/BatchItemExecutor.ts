import { Semaphore } from '@studnicky/concurrency/semaphore';
import { Throttle } from '@studnicky/throttle';

import { DAGError } from '../errors/DAGError.js';
import type { BatchExecutionOptionsType, BatchExecutionThrottleOptionsType } from '../types/BatchExecutionOptions.js';

type BatchItemExecutionPolicy = {
  readonly concurrency: number;
  readonly throttle: BatchExecutionThrottleOptionsType | null;
};

export class BatchItemExecutor {
  static async map<TItem, TResult>(
    items: readonly TItem[],
    mapper: (item: TItem, index: number) => Promise<TResult>,
    options: BatchExecutionOptionsType = {},
    signal: AbortSignal | null = null,
  ): Promise<readonly TResult[]> {
    const policy = BatchItemExecutor.#normalize(options);
    const semaphore = Semaphore.builder().withPermits(policy.concurrency).build();
    const throttle = BatchItemExecutor.#throttle(policy);
    const results: TResult[] = [];
    const errors: unknown[] = [];
    const workers: Promise<void>[] = [];
    const abortThrottle = (): void => {
      if (throttle === null) return;
      throttle.abort().catch(() => undefined);
    };

    signal?.addEventListener('abort', abortThrottle, { 'once': true });
    try {
      for (const [index, item] of items.entries()) {
        if (BatchItemExecutor.#isAborted(signal) || errors.length > 0) break;
        const release = await semaphore.acquire();
        if (BatchItemExecutor.#isAborted(signal) || errors.length > 0) {
          release();
          break;
        }

        const worker = BatchItemExecutor.#execute(throttle, () => mapper(item, index))
          .then(
            (result) => {
              results[index] = result;
            },
            (error: unknown) => {
              errors.push(error);
            },
          )
          .finally(release);
        workers.push(worker);
      }

      await Promise.all(workers);
    } finally {
      signal?.removeEventListener('abort', abortThrottle);
    }

    if (BatchItemExecutor.#isAborted(signal)) {
      throw DAGError.ofSignal(signal ?? undefined);
    }

    if (errors.length > 0) {
      const first = errors[0];
      throw first instanceof Error ? first : new DAGError(String(first), { 'code': 'EXECUTION_ERROR' });
    }

    return results;
  }

  static #isAborted(signal: AbortSignal | null): boolean {
    return signal?.aborted === true;
  }

  static #normalize(options: BatchExecutionOptionsType): BatchItemExecutionPolicy {
    return {
      'concurrency': BatchItemExecutor.#positiveInteger('execution.concurrency', options.concurrency ?? 1),
      'throttle':    options.throttle === undefined || options.throttle === null
        ? null
        : {
            'concurrencyLimit': BatchItemExecutor.#positiveInteger(
              'execution.throttle.concurrencyLimit',
              options.throttle.concurrencyLimit,
            ),
            ...(options.throttle.adaptive !== undefined ? { 'adaptive': options.throttle.adaptive } : {}),
          },
    };
  }

  static #positiveInteger(name: string, value: number): number {
    if (!Number.isInteger(value) || value < 1) {
      throw new DAGError(`${name} must be a positive integer`, {
        'code':    'CONFIGURATION_ERROR',
        'context': { name, value },
      });
    }
    return value;
  }

  static #throttle(policy: BatchItemExecutionPolicy): Throttle | null {
    if (policy.throttle === null) return null;
    const builder = Throttle.builder().withConcurrencyLimit(policy.throttle.concurrencyLimit);
    if (policy.throttle.adaptive !== undefined) {
      builder.withAdaptiveConcurrency(policy.throttle.adaptive);
    }
    return builder.build();
  }

  static async #execute<TResult>(
    throttle: Throttle | null,
    mapper: () => Promise<TResult>,
  ): Promise<TResult> {
    if (throttle === null) return mapper();
    const result = await throttle.execute(mapper);
    if (result === undefined) {
      throw new DAGError('Throttle detached batch item execution unexpectedly', { 'code': 'EXECUTION_ERROR' });
    }
    return result;
  }
}
