/**
 * CliTrigger: fires the runner once from a CLI command with parsed arguments.
 *
 * Abstracts the common pattern of parsing `process.argv`, validating the
 * command, and dispatching to a runner. Mirrors the `squashage` consumer
 * shape from the research study: a CLI entrypoint that selects a DAG by
 * command name and passes the remaining parsed args as input.
 *
 * Consumers subclass `CliTrigger` and override `parseArgs` to map raw
 * argv tokens to the `TInput` their runner expects. `selectDag` maps the
 * command token to a DAG name; the default implementation uses the command
 * token directly.
 *
 * @example
 * ```ts
 * type CliInput = { files: string[]; dryRun: boolean };
 *
 * class BuildCliTrigger extends CliTrigger<CliInput, BuildState, BuildOutput> {
 *   protected override parseArgs(command: string, args: string[]): CliInput {
 *     return { files: args.filter(a => !a.startsWith('--')), dryRun: args.includes('--dry-run') };
 *   }
 * }
 *
 * const trigger = new BuildCliTrigger('build', process.argv.slice(2));
 * await trigger.attach(runner);
 * ```
 */

import type { ExecuteOptionsType } from '../contracts/ExecuteOptionsType.js';
import type { TriggerInterface } from '../contracts/TriggerInterface.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

import type { DagRunnerInterface } from './DagRunner.js';

export abstract class CliTrigger<
  TInput,
  TState extends NodeStateInterface,
  TOutput,
  TServices = undefined,
> implements TriggerInterface<TInput, TState, TOutput, TServices> {
  readonly #command: string;
  readonly #args: readonly string[];
  readonly #options: ExecuteOptionsType;
  #result: TOutput | null;
  #detached: boolean;

  /**
   * @param command — The primary command token (e.g. `'build'`, `'run'`).
   *                  `selectDag` maps this to a DAG name.
   * @param args    — Remaining parsed argv tokens after the command.
   * @param options — Optional execute options (signal, deadlineMs).
   */
  constructor(command: string, args: readonly string[], options: ExecuteOptionsType = {}) {
    this.#command = command;
    this.#args = args;
    this.#options = options;
    this.#result = null;
    this.#detached = false;
  }

  /**
   * The output from the single `runner.run` call. Available only after
   * `attach` has resolved.
   */
  get result(): TOutput | null {
    return this.#result;
  }

  async attach(runner: DagRunnerInterface<TInput, TState, TOutput, TServices>): Promise<void> {
    if (this.#detached) return;
    const dagName = this.selectDag(this.#command);
    const input = this.parseArgs(this.#command, [...this.#args]);
    this.#result = await runner.run(dagName, input, this.#options);
  }

  async detach(): Promise<void> {
    this.#detached = true;
  }

  /**
   * Map the command token to a registered DAG name. Override to implement
   * command-to-dag routing (e.g. a dispatch map keyed by command token).
   * Default returns the command token unchanged.
   */
  protected selectDag(command: string): string {
    return command;
  }

  /**
   * Parse raw argv tokens into the `TInput` the runner expects.
   * Subclasses MUST override this method.
   */
  protected abstract parseArgs(command: string, args: string[]): TInput;
}
