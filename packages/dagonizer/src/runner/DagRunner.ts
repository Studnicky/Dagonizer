/**
 * DagRunner: canonical abstract base for DAG runner harnesses.
 *
 * Every consumer of `@studnicky/dagonizer` independently derived the same
 * ~50-line loop: register bundle → seed state → execute → route outcome →
 * project result. `DagRunner` owns that loop once. Consumers subclass and
 * override:
 *   - `seedState(input)`      — build the initial state from the trigger input
 *   - `projectResult(result)` — project the execution result to a domain value
 *
 * The runner is also the canonical home for checkpoint/resume: `run()` always
 * attempts fresh execution; `resume()` resumes from a cursor after rehydrating
 * state via the consumer's `seedState` override.
 *
 * The loop NEVER throws. Errors are collected in state; the final result
 * always arrives — no unhandled rejections escape the public `run`/`resume`
 * surface.
 *
 * @example
 * ```ts
 * class MyState extends NodeStateBase { value = 0; }
 * type MyInput = { value: number };
 * type MyOutput = { value: number; completed: boolean };
 *
 * class MyRunner extends DagRunner<MyInput, MyState, MyOutput> {
 *   protected override seedState(input: MyInput): MyState {
 *     const state = new MyState();
 *     state.value = input.value;
 *     return state;
 *   }
 *   protected override projectResult(result: ExecutionResultType<MyState>): MyOutput {
 *     return { value: result.state.value, completed: result.state.lifecycle.variant === 'completed' };
 *   }
 * }
 * ```
 */

import type { DispatcherBundleType } from '../contracts/DispatcherBundle.js';
import type { ExecuteOptionsType } from '../contracts/ExecuteOptionsType.js';
import type { Dagonizer } from '../Dagonizer.js';
import type { ExecutionResultType } from '../entities/execution/ExecutionResult.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

/**
 * Class-shape interface for `DagRunner`.
 *
 * Consumers that need to reference the runner without importing the concrete
 * class (e.g. trigger implementations that accept any typed runner) use this
 * interface. The concrete class implements it.
 *
 * TInput  — trigger-specific input; `seedState(input)` converts it to `TState`.
 * TState  — the domain state that flows through the DAG nodes.
 * TOutput — the projected output type returned by `run`/`resume`.
 */
export interface DagRunnerInterface<
  TInput,
  TState extends NodeStateInterface,
  TOutput,
> {
  /**
   * Register a `DispatcherBundleType` on the runner's dispatcher.
   * Delegates to `Dagonizer.registerBundle`. Call before `run`.
   */
  registerBundle(bundle: DispatcherBundleType<TState>): void;

  /**
   * Execute the named DAG from its entrypoint with a freshly seeded state.
   * The input is passed to `seedState` to build the initial state.
   * Never throws — errors are collected in state and the result is always returned.
   */
  run(dagName: string, input: TInput, options?: ExecuteOptionsType): Promise<TOutput>;

  /**
   * Resume the named DAG from `fromStage` using a rehydrated state.
   * The caller is responsible for rehydrating `state` before the call
   * (typically via `Checkpoint.load(raw).restoreState(fn)`).
   * Never throws — same semantics as `run`.
   */
  resume(dagName: string, state: TState, fromStage: string, options?: ExecuteOptionsType): Promise<TOutput>;
}

/**
 * Options accepted by `DagRunner` constructor.
 *
 * TState — the concrete state type the runner operates on.
 */
export type DagRunnerOptionsType<
  TState extends NodeStateInterface = NodeStateInterface,
> = {
  /**
   * The configured `Dagonizer` instance that the runner drives.
   * Injected via constructor (DI via class extension, no callbacks).
   */
  dispatcher: Dagonizer<TState>;
};

/**
 * Abstract base class for DAG runner harnesses.
 *
 * Subclass and override `seedState` and `projectResult`. Optionally override
 * `onRunError` to handle unexpected errors that escape the engine's never-throw
 * guarantee (these indicate framework bugs and should be rare).
 *
 * The runner intentionally holds a reference to the dispatcher instance rather
 * than owning construction of it, so consumers can configure the dispatcher
 * (containers, channels) before handing it to the runner.
 */
export abstract class DagRunner<
  TInput,
  TState extends NodeStateInterface,
  TOutput,
> implements DagRunnerInterface<TInput, TState, TOutput> {
  protected readonly dispatcher: Dagonizer<TState>;

  constructor(options: DagRunnerOptionsType<TState>) {
    this.dispatcher = options.dispatcher;
  }

  /**
   * Register a `DispatcherBundleType` on the runner's dispatcher.
   */
  registerBundle(bundle: DispatcherBundleType<TState>): void {
    this.dispatcher.registerBundle(bundle);
  }

  /**
   * Execute the named DAG with a freshly seeded state built from `input`.
   * Never throws — the result is always returned. Caught unexpected errors
   * route through `onRunError`.
   */
  async run(dagName: string, input: TInput, options: ExecuteOptionsType = {}): Promise<TOutput> {
    try {
      const state = this.seedState(input);
      const result = await this.dispatcher.execute(dagName, state, options);
      return this.projectResult(result);
    } catch (err) {
      return this.onRunError(dagName, err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Resume the named DAG from `fromStage` with a pre-rehydrated state.
   * The caller is responsible for rehydrating state before the call.
   * Never throws — same semantics as `run`.
   */
  async resume(dagName: string, state: TState, fromStage: string, options: ExecuteOptionsType = {}): Promise<TOutput> {
    try {
      const result = await this.dispatcher.resume(dagName, state, fromStage, options);
      return this.projectResult(result);
    } catch (err) {
      return this.onRunError(dagName, err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Build the initial state from a trigger input. Override in subclasses
   * to map domain-specific input (CLI args, HTTP body, event payload) to
   * the concrete `TState` shape.
   *
   * Subclasses MUST override.
   */
  protected abstract seedState(input: TInput): TState;

  /**
   * Project the raw `ExecutionResultType<TState>` to the consumer's domain
   * output type. Override in subclasses to extract counts, lifecycle info,
   * or a rendered response from the final state.
   *
   * Subclasses MUST override.
   */
  protected abstract projectResult(result: ExecutionResultType<TState>): TOutput;

  /**
   * Called when an unexpected error escapes the engine (framework bug, not
   * a node error — those are collected in state). Default re-throws. Override
   * to absorb and return a fallback `TOutput` if callers need continuity.
   */
  protected onRunError(_dagName: string, error: Error): TOutput {
    throw error;
  }
}
