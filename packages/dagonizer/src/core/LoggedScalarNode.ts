/**
 * LoggedScalarNode: route-don't-throw enforcement layer for per-item nodes.
 *
 * Extends `ScalarNode` and seals `executeOne` so subclasses CANNOT accidentally
 * propagate a thrown error past the node boundary. Subclasses implement
 * `runOne(state, context)` instead; the base wraps every call in a try/catch
 * and routes any escaped throw to the `'error'` output port by collecting a
 * structured error onto state.
 *
 * This makes the "nodes route, never throw" contract the path of least
 * resistance: a subclass that throws from `runOne` is caught here, not
 * silently swallowed but surfaced as a clear contract error (code
 * `nodeContractViolation`) that names the offending node.
 *
 * ## Type parameters
 *
 * - `TUserOutput` — the output ports the subclass declares (never include
 *   `'error'`; the base adds it). Example: `'success' | 'skip'`.
 * - `TState` — the node-state type flowing through the batch.
 *
 * The effective `TOutput` seen by `ScalarNode` is `TUserOutput | 'error'`,
 * which means `'error'` is always a valid return port — the base adds it
 * without requiring subclasses to declare it.
 *
 * ## Dev-mode assertion
 *
 * When `devMode` is `true` (default), an escaped throw from `runOne` is
 * re-thrown as a descriptive `Error` **after** routing to `'error'`, surfacing
 * the contract violation immediately rather than letting the error silently
 * accumulate in state. Set `devMode: false` in production to suppress the
 * rethrow and let the `'error'` routing handle it gracefully.
 *
 * @example
 * ```ts
 * class SummaryNode extends LoggedScalarNode<MyState, 'done' | 'skip'> {
 *   readonly name = 'summary';
 *   readonly outputs = ['done', 'skip', 'error'] as const;
 *   override get outputSchema() { return { done: { type: 'object' }, skip: { type: 'object' }, error: { type: 'object' } }; }
 *   protected async runOne(state: MyState): Promise<NodeOutputType<'done' | 'skip'>> {
 *     if (!state.hasContent) return NodeOutputBuilder.of('skip');
 *     // Any thrown error here is caught and routed to 'error'. No try/catch needed.
 *     await state.summarize();
 *     return NodeOutputBuilder.of('done');
 *   }
 * }
 * ```
 */

import type { NodeContextType } from '../entities/node/NodeContext.js';
import { NodeErrorBuilder } from '../entities/node/NodeError.js';
import { NodeOutputBuilder } from '../entities/node/NodeOutput.js';
import type { NodeOutputType } from '../entities/node/NodeOutput.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

import { ScalarNode } from './ScalarNode.js';

/**
 * Options for `LoggedScalarNode`.
 *
 * `devMode` controls whether an escaped throw from `runOne` is re-thrown
 * as a contract error after routing to `'error'`. Required-with-default:
 * the field is always present on a constructed instance; callers that omit
 * the options object receive `devMode: true`.
 */
export type LoggedScalarNodeOptionsType = {
  /**
   * When `true` (default), an escaped throw is re-thrown as a clear
   * `nodeContractViolation` error so node authors learn immediately that
   * the route-don't-throw contract was violated.
   *
   * Set to `false` in production environments to suppress the rethrow and
   * let the `'error'` routing handle the failure gracefully.
   */
  readonly 'devMode': boolean;
};

/** Default options. Module-level constant — one hidden class, one allocation. */
const DEFAULT_OPTIONS: LoggedScalarNodeOptionsType = { 'devMode': true };

/**
 * Route-don't-throw enforcement base for per-item nodes.
 *
 * Extend this class instead of `ScalarNode` when authoring domain nodes.
 * Implement `runOne`; never implement `executeOne`.
 *
 * @typeParam TUserOutput  Output ports the subclass declares. Do not include
 *                         `'error'`; the base adds it automatically.
 * @typeParam TState       Node state flowing through the batch.
 */
export abstract class LoggedScalarNode<
  TState extends NodeStateInterface,
  TUserOutput extends string,
> extends ScalarNode<TState, TUserOutput | 'error'> {

  /** Options controlling dev-mode contract assertion. */
  readonly options: LoggedScalarNodeOptionsType;

  /**
   * @param options  Optional configuration. Defaults to `{ devMode: true }`.
   */
  constructor(options: LoggedScalarNodeOptionsType = DEFAULT_OPTIONS) {
    super();
    this.options = options;
  }

  /**
   * Per-item execution seam. Subclasses implement this.
   *
   * Any error thrown from `runOne` is caught by the base and routed to
   * the `'error'` output port. Subclasses do not need a try/catch.
   */
  protected abstract runOne(
    state: TState,
    context: NodeContextType,
  ): Promise<NodeOutputType<TUserOutput>>;

  /**
   * Sealed implementation of `ScalarNode.executeOne`.
   *
   * Calls `runOne` and returns its result unchanged when it succeeds.
   * Catches any escaped throw, collects a structured `nodeContractViolation`
   * error onto state, and returns `NodeOutputBuilder.of('error')`. In
   * dev-mode, the escaped throw is also re-thrown as a descriptive error
   * so authors learn about the violation immediately.
   */
  protected override async executeOne(
    state: TState,
    context: NodeContextType,
  ): Promise<NodeOutputType<TUserOutput | 'error'>> {
    try {
      return await this.runOne(state, context);
    } catch (thrown: unknown) {
      const message =
        thrown instanceof Error ? thrown.message : String(thrown);

      state.collectError(
        NodeErrorBuilder.from(
          'nodeContractViolation',
          `Node '${this.name}' threw instead of routing to 'error': ${message}`,
          'runOne',
          false,
          new Date().toISOString(),
          { 'context': { 'nodeName': this.name, 'thrownMessage': message } },
        ),
      );

      if (this.options['devMode']) {
        throw new Error(
          `[LoggedScalarNode] Contract violation in node '${this.name}': ` +
          `'runOne' threw instead of routing to the 'error' output port. ` +
          `Nodes must catch their own errors and route them; they must never throw past the node boundary. ` +
          `Original error: ${message}`,
          { 'cause': thrown },
        );
      }

      return NodeOutputBuilder.of('error');
    }
  }
}
