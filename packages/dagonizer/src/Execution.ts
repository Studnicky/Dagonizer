/**
 * Execution: the canonical handle returned by `Dagonizer.execute()` /
 * `Dagonizer.resume()`.
 *
 * Single execution path:
 *
 *   const result = await dispatcher.execute('flow', state);          // summary
 *   for await (const stage of dispatcher.execute('flow', state)) {}  // streaming
 *
 * Both consumption modes share a single internal generator; calling
 * `await` on an Execution that has already been iterated returns the
 * cached final result. The flow body runs exactly once.
 *
 * Abort semantics: the iterator never throws. When the composed signal
 * aborts, when a node throws, or when a node routes to an output
 * with no wiring, the iterator stops and the final `ExecutionResult`
 * carries the cursor (next node to run on resume). The state's
 * `lifecycle.variant` records what happened.
 *
 * Correlation context: `Dagonizer.execute()`/`resume()` seeds a
 * `DagExecutionContext` `ContextScope` with a correlation id and the DAG
 * name, and passes it here. Every `gen.next()` call is driven through
 * `scope.execute()` rather than awaited directly — an `AsyncLocalStorage`
 * scope only propagates through the async chain initiated *inside* the
 * `execute()` call, and an async generator does not begin (or resume)
 * running its body until `next()` is called, so each turn must be
 * individually wrapped for the seeded values to reach the node bodies and
 * lifecycle hooks that run during that turn, however deeply nested (embedded
 * DAG bodies and scatter items are driven by nested generators within the
 * same turn). The scope is terminated once the flow body completes.
 *
 * @example
 * ```ts
 * // Sync-style
 * const result = await dispatcher.execute('myFlow', initialState);
 * console.log(result.state.lifecycle.variant); // 'completed'
 *
 * // Streaming
 * const execution = dispatcher.execute('myFlow', initialState);
 * for await (const node of execution) {
 *   console.log(node.nodeName, node.output);
 * }
 * ```
 */

import type { ContextScope } from '@studnicky/context';

import type { ExecutionResultType } from './entities/execution/ExecutionResult.js';
import type { NodeResultType } from './entities/node/NodeResult.js';
import type { NodeStateInterface } from './NodeStateBase.js';

export class Execution<TState extends NodeStateInterface>
implements AsyncIterable<NodeResultType<NodeStateInterface>>, PromiseLike<ExecutionResultType<TState>> {
  readonly #generator: AsyncGenerator<NodeResultType<NodeStateInterface>, ExecutionResultType<TState>, void>;
  readonly #scope: ContextScope;
  #drained: Promise<ExecutionResultType<TState>> | null = null;
  #cachedResult: ExecutionResultType<TState> | null = null;

  /**
   * Wrap an already-created flow generator with the `ContextScope` that
   * carries this run's correlation context.
   *
   * The dispatcher passes `this.runNodes(...)` directly: an async generator
   * function returns a generator that does not begin executing until the first
   * `next()`, so construction is side-effect-free. The flow body runs exactly
   * once, lazily, on the first iteration or `await`. There is no factory
   * function-pass-in — the generator IS the execution.
   */
  constructor(
    generator: AsyncGenerator<NodeResultType<NodeStateInterface>, ExecutionResultType<TState>, void>,
    scope: ContextScope,
  ) {
    this.#generator = generator;
    this.#scope = scope;
  }

  [Symbol.asyncIterator](): AsyncGenerator<NodeResultType<NodeStateInterface>, ExecutionResultType<TState>, void> {
    return this.#iterate();
  }

  /**
   * Awaiting an `Execution` resolves to the final `ExecutionResultType`.
   * If the iterator has already been consumed, the cached result is
   * returned; otherwise the generator is drained.
   */
  then<TResult1 = ExecutionResultType<TState>, TResult2 = never>(
    onfulfilled?: ((value: ExecutionResultType<TState>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    if (this.#drained === null) {
      this.#drained = this.#drain();
    }
    return this.#drained.then(onfulfilled, onrejected);
  }

  async *#iterate(): AsyncGenerator<NodeResultType<NodeStateInterface>, ExecutionResultType<TState>, void> {
    if (this.#cachedResult !== null) {
      return this.#cachedResult;
    }
    const gen = this.#generator;
    const scope = this.#scope;
    while (true) {
      // Each turn is driven through `scope.execute()` (not awaited directly)
      // so the seeded correlation context is active for every node/hook that
      // runs during this turn — see the class-level doc comment.
      const next = await scope.execute(() => gen.next());
      if (next.done === true) {
        this.#cachedResult = next.value;
        scope.terminate();
        return next.value;
      }
      yield next.value;
    }
  }

  async #drain(): Promise<ExecutionResultType<TState>> {
    if (this.#cachedResult !== null) return this.#cachedResult;
    const it = this.#iterate();
    while (true) {
      const next = await it.next();
      if (next.done === true) return next.value;
    }
  }
}
