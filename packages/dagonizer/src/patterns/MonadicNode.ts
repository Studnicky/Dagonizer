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
 * but doesn't vary by domain: name, outputs, contract (defaults to
 * `EMPTY_CONTRACT_FRAGMENT`), optional timeout, optional validate/destroy
 * hooks. Subclasses
 * declare what they need (`abstract readonly name`, `abstract readonly
 * outputs`, `abstract execute`) and inherit the rest. Subclasses
 * return output port literals directly in `execute()` — no indirection
 * helpers are provided; return the string literal for V8 monomorphism.
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
import { EMPTY_CONTRACT_FRAGMENT } from '../contracts/OperationContractFragment.js';
import type { OperationContractFragment } from '../contracts/OperationContractFragment.js';
import type { NodeContextInterface } from '../entities/node/NodeContext.js';
import type { NodeOutputInterface } from '../entities/node/NodeOutput.js';
import type { ValidationResult } from '../entities/validation/ValidationResult.js';
import type { NodeStateInterface } from '../NodeStateBase.js';
import { Timeout } from '../runtime/Timeout.js';

export abstract class MonadicNode<
  TState extends NodeStateInterface = NodeStateInterface,
  TOutput extends string = 'success' | 'empty' | 'error',
  TServices = undefined,
> implements NodeInterface<TState, TOutput, TServices> {
  /** Stable identifier used at registration with the dispatcher. */
  abstract readonly name: string;

  /** Literal union of output port names. Narrows placement routing. */
  abstract readonly outputs: readonly TOutput[];

  /**
   * Data-flow declaration for `DAGDeriver`. The default `EMPTY_CONTRACT_FRAGMENT`
   * (both arrays empty) means "no derivation edges" — the deriver skips this node.
   * Subclasses that participate in contract-derived flow generation override this
   * with a populated fragment.
   */
  readonly contract: OperationContractFragment = EMPTY_CONTRACT_FRAGMENT;

  /**
   * Per-node wall-clock budget. `Timeout.none()` means no time limit.
   * Subclasses override to set a concrete budget via `Timeout.ofMs(n)`.
   * The `NodeInterface` contract keeps this optional (external boundary);
   * `MonadicNode` supplies the concrete required-with-default to keep
   * V8 hidden-class stable.
   */
  readonly timeout: Timeout = Timeout.none();

  /**
   * Execute the node, mutating state. Returns a result indicating which
   * output port to route to. Never throws; catches all errors internally
   * and routes to an error output.
   */
  abstract execute(
    state: TState,
    context: NodeContextInterface<TServices>,
  ): Promise<NodeOutputInterface<TOutput>>;

  /**
   * Validate node configuration at flow registration time. Default
   * implementation returns a valid result with no errors. Subclasses
   * override to check their own invariants (e.g. required config fields).
   *
   * The `NodeInterface` contract keeps `validate?()` optional at the external
   * boundary; `MonadicNode` supplies a concrete required-with-default so every
   * subclass always has a validation method without needing a presence check.
   */
  validate(): ValidationResult {
    return { 'valid': true, 'errors': [] };
  }

  /**
   * Clean up resources when the dispatcher is destroyed. Default
   * implementation is a no-op. Subclasses override to release connections,
   * timers, or other held resources.
   *
   * The `NodeInterface` contract keeps `destroy?()` optional at the external
   * boundary; `MonadicNode` supplies a concrete required-with-default so every
   * subclass always has a destroy method without needing a presence check.
   */
  async destroy(): Promise<void> {
    // no-op default
  }

}
