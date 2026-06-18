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
 * `lifecycle.kind` records what happened.
 *
 * @example
 * ```ts
 * // Sync-style
 * const result = await dispatcher.execute('myFlow', initialState);
 * console.log(result.state.lifecycle.kind); // 'completed'
 *
 * // Streaming
 * const execution = dispatcher.execute('myFlow', initialState);
 * for await (const node of execution) {
 *   console.log(node.nodeName, node.output);
 * }
 * ```
 */

import type { ExecutionResultInterface } from './entities/execution/ExecutionResult.js';
import type { NodeResultInterface } from './entities/node/NodeResult.js';
import type { NodeStateInterface } from './NodeStateBase.js';

export class Execution<TState extends NodeStateInterface>
implements AsyncIterable<NodeResultInterface<TState>>, PromiseLike<ExecutionResultInterface<TState>> {
  readonly #generator: AsyncGenerator<NodeResultInterface<TState>, ExecutionResultInterface<TState>, void>;
  #drained: Promise<ExecutionResultInterface<TState>> | null = null;
  #cachedResult: ExecutionResultInterface<TState> | null = null;

  /**
   * Wrap an already-created flow generator.
   *
   * The dispatcher passes `this.runNodes(...)` directly: an async generator
   * function returns a generator that does not begin executing until the first
   * `next()`, so construction is side-effect-free. The flow body runs exactly
   * once, lazily, on the first iteration or `await`. There is no factory
   * function-pass-in — the generator IS the execution.
   */
  constructor(generator: AsyncGenerator<NodeResultInterface<TState>, ExecutionResultInterface<TState>, void>) {
    this.#generator = generator;
  }

  [Symbol.asyncIterator](): AsyncGenerator<NodeResultInterface<TState>, ExecutionResultInterface<TState>, void> {
    return this.#iterate();
  }

  /**
   * Awaiting an `Execution` resolves to the final `ExecutionResultInterface`.
   * If the iterator has already been consumed, the cached result is
   * returned; otherwise the generator is drained.
   */
  then<TResult1 = ExecutionResultInterface<TState>, TResult2 = never>(
    onfulfilled?: ((value: ExecutionResultInterface<TState>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    if (this.#drained === null) {
      this.#drained = this.#drain();
    }
    return this.#drained.then(onfulfilled, onrejected);
  }

  async *#iterate(): AsyncGenerator<NodeResultInterface<TState>, ExecutionResultInterface<TState>, void> {
    if (this.#cachedResult !== null) {
      return this.#cachedResult;
    }
    const gen = this.#generator;
    while (true) {
      const next = await gen.next();
      if (next.done === true) {
        this.#cachedResult = next.value;
        return next.value;
      }
      yield next.value;
    }
  }

  async #drain(): Promise<ExecutionResultInterface<TState>> {
    if (this.#cachedResult !== null) return this.#cachedResult;
    const it = this.#iterate();
    while (true) {
      const next = await it.next();
      if (next.done === true) return next.value;
    }
  }
}
