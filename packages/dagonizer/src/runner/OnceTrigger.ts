/**
 * OnceTrigger: fires the runner exactly once with the supplied input.
 *
 * The simplest trigger variant. Suitable for batch jobs, test harnesses,
 * and single-invocation CLI scripts that run one DAG and exit. Mirrors the
 * `resume-generator` consumer shape identified in the research study.
 *
 * @example
 * ```ts
 * const trigger = new OnceTrigger<MyInput, MyState, MyOutput>('my-dag', input);
 * await trigger.attach(runner);
 * const result = trigger.result; // available after attach resolves
 * ```
 */

import type { ExecuteOptionsType } from '../contracts/ExecuteOptionsType.js';
import type { TriggerInterface } from '../contracts/TriggerInterface.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

import type { DagRunnerInterface } from './DagRunner.js';

export class OnceTrigger<
  TInput,
  TState extends NodeStateInterface,
  TOutput,
> implements TriggerInterface<TInput, TState, TOutput> {
  readonly #dagName: string;
  readonly #input: TInput;
  readonly #options: ExecuteOptionsType;
  #result: TOutput | null;
  #detached: boolean;

  constructor(dagName: string, input: TInput, options: ExecuteOptionsType = {}) {
    this.#dagName = dagName;
    this.#input = input;
    this.#options = options;
    this.#result = null;
    this.#detached = false;
  }

  /**
   * The output from the single `runner.run` call. Available only after
   * `attach` has resolved. `null` before the run completes or if `detach`
   * was called before `attach`.
   */
  get result(): TOutput | null {
    return this.#result;
  }

  async attach(runner: DagRunnerInterface<TInput, TState, TOutput>): Promise<void> {
    if (this.#detached) return;
    this.#result = await runner.run(this.#dagName, this.#input, this.#options);
  }

  async detach(): Promise<void> {
    this.#detached = true;
  }
}
