/**
 * virtual-clock/dags: pure module — a per-node-timeout DAG (state, slow
 * node, DAG const), plus re-exports of the virtual time providers.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/virtual-clock.ts (the executable entry point).
 */

import {
  Batch,
  DAG_CONTEXT,
  MonadicNode,
  NodeStateBase,
  Timeout,
} from '@studnicky/dagonizer';
import type { DAGType, NodeContextType, SchemaObjectType } from '@studnicky/dagonizer';
import type { SchedulerProviderInterface } from '@studnicky/dagonizer/contracts';
import { VirtualTimeCounter } from '@studnicky/clock';
import * as SchedulerPkg from '@studnicky/scheduler';
import { RoutedBatch } from '@studnicky/dagonizer';

export { Scheduler } from '@studnicky/dagonizer/runtime';
export { VirtualTimeCounter } from '@studnicky/clock';

class SchedulerAbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AbortError';
  }
}

type PendingRejectType = {
  readonly reject: (reason: Error) => void;
};

export class VirtualScheduler extends SchedulerPkg.VirtualScheduler implements SchedulerProviderInterface {
  readonly #counter: VirtualTimeCounter;
  readonly #pending = new Map<string, PendingRejectType>();

  constructor(initialAtMs: number = 0) {
    const counter = VirtualTimeCounter.create({ 'startMs': initialAtMs });
    super(counter);
    this.#counter = counter;
  }

  after(delayMs: number, options?: { readonly signal?: AbortSignal }): Promise<void> {
    return this.at(this.#counter.nowMs() + Math.max(0, delayMs), options);
  }

  at(atMs: number, options?: { readonly signal?: AbortSignal }): Promise<void> {
    const signal = options?.signal;
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(signal.reason instanceof Error ? signal.reason : new SchedulerAbortError('aborted'));
        return;
      }
      const task = this.scheduleAt(atMs, () => {
        this.#pending.delete(task.id);
        signal?.removeEventListener('abort', onAbort);
        resolve();
      });
      this.#pending.set(task.id, { reject });
      const onAbort = (): void => {
        this.#pending.delete(task.id);
        task.cancel();
        signal?.removeEventListener('abort', onAbort);
        reject(signal?.reason instanceof Error ? signal.reason : new SchedulerAbortError('aborted'));
      };
      signal?.addEventListener('abort', onAbort, { 'once': true });
    });
  }

  async *every(intervalMs: number, options?: { readonly signal?: AbortSignal }): AsyncIterable<void> {
    const signal = options?.signal;
    while (signal?.aborted !== true) {
      try {
        await this.after(intervalMs, options);
      } catch {
        return;
      }
      yield;
    }
  }

  override cancelAll(): void {
    super.cancelAll();
    for (const entry of this.#pending.values()) {
      entry.reject(new SchedulerAbortError('cancelled'));
    }
    this.#pending.clear();
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export class SlowState extends NodeStateBase {}

// ---------------------------------------------------------------------------
// Node: a per-node `timeout` budget. The engine arms the deadline via
// `Scheduler.current().after(ms, ...)` (src/Dagonizer.ts `withNodeTimeout`),
// so a VirtualScheduler installed before `dispatcher.execute()` drives the
// deadline deterministically via `advance()` — no real wait required.
// ---------------------------------------------------------------------------

// #region slow-node
export class SlowNode extends MonadicNode<SlowState, 'success'> {
  readonly name = 'slow';
  readonly '@id' = 'urn:noocodec:node:slow';
  readonly outputs = ['success'] as const;
  override readonly timeout = Timeout.ofMs(200);
  override get outputSchema(): Record<'success', SchemaObjectType> {
    return { 'success': { 'type': 'object' } };
  }

  override async execute(batch: Batch<SlowState>, context: NodeContextType) {
    // Suspends until the per-node deadline aborts context.signal.
    await new Promise<never>((_resolve, reject) => {
      context.signal.addEventListener('abort', () => { reject(context.signal.reason); }, { 'once': true });
    });
    return RoutedBatch.create('success', batch);
  }
}
// #endregion slow-node

// ---------------------------------------------------------------------------
// DAG
// ---------------------------------------------------------------------------

export const dag: DAGType = {
  '@context':   DAG_CONTEXT,
  '@id': 'urn:noocodec:dag:virtual-clock-dag',
  '@type':      'DAG',
  'name':       'virtual-clock-dag',
  'version':    '1',
  'entrypoints': { 'main': 'urn:noocodec:dag:virtual-clock-dag/node/slow' },
  'nodes': [
    {
      '@id': 'urn:noocodec:dag:virtual-clock-dag/node/slow',
      '@type':   'SingleNode',
      'name':    'slow',
      'node':    'urn:noocodec:node:slow',
      'outputs': { 'success': 'urn:noocodec:dag:virtual-clock-dag/node/end' },
    },
    {
      '@id': 'urn:noocodec:dag:virtual-clock-dag/node/end',
      '@type':   'TerminalNode',
      'name':    'end',
      'outcome': 'completed',
    },
  ],
};
