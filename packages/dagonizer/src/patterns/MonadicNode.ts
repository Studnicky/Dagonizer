/**
 * MonadicNode: the root of every canonical DAG pattern.
 *
 * Each node is a self-contained unit of computation: a function from
 * `(state, context) → output`, deterministic in routing, total over its
 * declared output ports. The "monadic" framing captures three traits
 * the pattern taxonomy depends on:
 *
 *   1. Context-carrying: execution sees the dispatcher's services bag
 *      and the abort signal alongside the state, not as ambient globals.
 *   2. Composable: output-port routing chains nodes into larger flows
 *      via the dispatcher's placement graph (the bind operation in
 *      Dagonizer terms).
 *   3. Total: every code path returns a `NodeOutputInterface<TOutput>`
 *      naming one of the declared ports; nothing throws past the node
 *      boundary.
 *
 * Implements `NodeInterface` and supplies the fields a pattern needs
 * but doesn't vary by domain: name, outputs, optional contract,
 * optional timeoutMs, optional validate/destroy hooks. Subclasses
 * declare what they need (`abstract readonly name`, `abstract readonly
 * outputs`, `abstract execute`) and inherit the rest.
 *
 * Pattern packages (rag, graph, flow) ship intermediate base classes
 * that extend this root and add their own dispatch loops. Consumers
 * extend the leaf pattern they want (`ClassifyIntentNode`,
 * `RecallContextNode`, `DedupeByKeyNode`, …) and inject domain-specific
 * pieces via the abstract methods those leaves declare.
 *
 * @typeParam TState    the node state the dispatcher passes to execute.
 * @typeParam TOutput   the literal union of output port names. Narrows
 *                      the placement-routing surface at compile time.
 * @typeParam TServices the services bag shape. `undefined` for nodes
 *                      that don't need any service.
 */

import type { NodeInterface } from '../contracts/NodeInterface.js';
import type { OperationContractFragment } from '../contracts/OperationContractFragment.js';
import type { NodeContextInterface } from '../entities/node/NodeContext.js';
import type { NodeOutputInterface } from '../entities/node/NodeOutput.js';
import type { ValidationResult } from '../entities/validation/ValidationResult.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

export abstract class MonadicNode<
  TState extends NodeStateInterface = NodeStateInterface,
  TOutput extends string = string,
  TServices = undefined,
> implements NodeInterface<TState, TOutput, TServices> {
  /** Stable identifier used at registration with the dispatcher. */
  abstract readonly name: string;

  /** Literal union of output port names. Narrows placement routing. */
  abstract readonly outputs: readonly TOutput[];

  /**
   * Optional data-flow declaration. When present, `DAGDeriver` can use
   * this node in contract-derived flow generation.
   */
  readonly contract?: OperationContractFragment;

  /**
   * Optional per-node wall-clock budget in milliseconds. When set, the
   * engine schedules an abort after `timeoutMs` and the child signal is
   * passed as `context.signal` to this node's `execute()` only.
   */
  readonly timeoutMs?: number;

  /**
   * Execute the node, mutating state. Returns a result indicating which
   * output port to route to. Never throws; catches all errors internally
   * and routes to an error output.
   */
  abstract execute(
    state: TState,
    context: NodeContextInterface<TServices>,
  ): Promise<NodeOutputInterface<TOutput>>;

  /** Optional validation invoked at flow registration. */
  validate?(): ValidationResult;

  /** Optional cleanup invoked when the dispatcher is destroyed. */
  destroy?(): Promise<void>;

  /** Conventional routing-output token for the happy path. Override for non-standard ports. */
  protected successPort(): TOutput { return 'success' as TOutput; }
  /** Conventional routing-output token for the no-result path. */
  protected emptyPort(): TOutput { return 'empty' as TOutput; }
  /** Conventional routing-output token for the error path. */
  protected errorPort(): TOutput { return 'error' as TOutput; }
}
