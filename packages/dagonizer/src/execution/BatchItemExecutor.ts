import { Semaphore } from '@studnicky/concurrency/semaphore';
import { Throttle } from '@studnicky/throttle';
import { TIMING_STATUS } from '@studnicky/timing';
import type { TimingEventDataType, TimingInterface } from '@studnicky/timing/interfaces';
import type { TimingStatusValueType } from '@studnicky/timing/types';

import { DAGError } from '../errors/DAGError.js';
import type { BatchExecutionOptionsType, BatchExecutionThrottleOptionsType } from '../types/BatchExecutionOptions.js';

type BatchItemExecutionPolicy = {
  readonly concurrency: number;
  readonly throttle: BatchExecutionThrottleOptionsType | null;
  readonly timing: TimingInterface | null;
};

export class BatchItemExecutor {
  static async map<TItem, TResult>(
    items: readonly TItem[],
    mapper: (item: TItem, index: number) => Promise<TResult>,
    options: BatchExecutionOptionsType = {},
    signal: AbortSignal | null = null,
  ): Promise<readonly TResult[]> {
    const policy = BatchItemExecutor.#normalize(options);
    const semaphore = Semaphore.create({ 'permits': policy.concurrency });
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

        const worker = BatchItemExecutor.#execute(policy.timing, throttle, () => mapper(item, index))
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
      'timing':      options.timing ?? null,
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
    return Throttle.create({
      'concurrencyLimit': policy.throttle.concurrencyLimit,
      ...(policy.throttle.adaptive !== undefined ? { 'adaptive': policy.throttle.adaptive } : {}),
    });
  }

  static async #execute<TResult>(
    timing: TimingInterface | null,
    throttle: Throttle | null,
    mapper: () => Promise<TResult>,
  ): Promise<TResult> {
    BatchItemExecutor.#time(timing, TIMING_STATUS.START);
    try {
      if (throttle === null) {
        const direct = await mapper();
        BatchItemExecutor.#time(timing, TIMING_STATUS.COMPLETE);
        return direct;
      }
      const result = await throttle.execute(mapper);
      if (result === undefined) {
        throw new DAGError('Throttle detached batch item execution unexpectedly', { 'code': 'EXECUTION_ERROR' });
      }
      BatchItemExecutor.#time(timing, TIMING_STATUS.COMPLETE);
      return result;
    } catch (error) {
      BatchItemExecutor.#time(timing, TIMING_STATUS.ERROR);
      throw error;
    }
  }

  static #time(timing: TimingInterface | null, status: TimingStatusValueType): void {
    timing?.event(
      { 'event': `batch.item.${status}` } satisfies TimingEventDataType,
    );
  }
}
