/**
 * Execution: the canonical handle returned by `Dagonizer.execute()` /
 * `Dagonizer.resume()`.
 *
 * Single execution path:
 *
 *   const result = await dispatcher.execute('urn:noocodec:dag:flow', state);          // summary
 *   for await (const stage of dispatcher.execute('urn:noocodec:dag:flow', state)) {}  // streaming
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
 * `DagExecutionContext` `DagExecutionScope` anchored to the run's own
 * `AbortSignal` and passes it here. Unlike an ambient "current scope"
 * pointer, an identity-keyed anchor needs no per-turn swap/restore around
 * `gen.next()`: every node body and lifecycle hook that runs during the
 * flow already carries that same `AbortSignal` (via `NodeContextType.signal`
 * or as a hook parameter) and reads context through it directly, correct
 * regardless of how many internal `await`s ran first. `Execution` only owns
 * the scope's lifetime — draining `gen.next()` calls plainly and terminating
 * the scope in a `finally` block, so its bindings are released whether the
 * flow body runs to completion or the caller abandons iteration early (e.g.
 * `break`ing out of a `for await` loop mid-stream, which drives the
 * async-iterator protocol's implicit `.return()` into this generator).
 *
 * @example
 * ```ts
 * // Sync-style
 * const result = await dispatcher.execute('urn:noocodec:dag:my-flow', initialState);
 * console.log(result.state.lifecycle.variant); // 'completed'
 *
 * // Streaming
 * const execution = dispatcher.execute('urn:noocodec:dag:my-flow', initialState);
 * for await (const node of execution) {
 *   console.log(node.nodeName, node.output);
 * }
 * ```
 */

import type { ExecutionResultType } from './entities/execution/ExecutionResult.js';
import type { NodeResultType } from './entities/node/NodeResult.js';
import type { NodeStateInterface } from './NodeStateBase.js';
import type { DagExecutionScope } from './runtime/DagExecutionContext.js';

export class Execution<TState extends NodeStateInterface>
implements AsyncIterable<NodeResultType<NodeStateInterface>>, PromiseLike<ExecutionResultType<TState>> {
  readonly #generator: AsyncGenerator<NodeResultType<NodeStateInterface>, ExecutionResultType<TState>, void>;
  readonly #scope: DagExecutionScope;
  #drained: Promise<ExecutionResultType<TState>> | null = null;
  #cachedResult: ExecutionResultType<TState> | null = null;

  /**
   * Wrap an already-created flow generator with the `DagExecutionScope` that
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
    scope: DagExecutionScope,
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
    try {
      while (true) {
        const next = await gen.next();
        if (next.done === true) {
          this.#cachedResult = next.value;
          return next.value;
        }
        yield next.value;
      }
    } finally {
      // Runs on normal completion AND on early abandonment (a `for await`
      // consumer `break`ing mid-stream drives the async-generator protocol's
      // implicit `.return()` here) — the scope's bindings are released either
      // way. `terminate()` is safe to call more than once.
      scope.terminate();
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
