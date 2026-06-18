/**
 * MonadicNode: the root of every node — the minimum viable node.
 *
 * A node is the monad of the engine: it consumes a `Batch<TState>` and returns
 * a `RoutedBatch<TOutput, TState>`, partitioning the batch's items across its
 * declared output ports. That single operation is the one node contract
 * (`NodeInterface.execute`); `MonadicNode` is the abstract base that supplies
 * the boilerplate every node needs and leaves `execute` for the author to
 * implement. The "monadic" framing captures three traits the pattern taxonomy
 * depends on:
 *
 *   1. Context-carrying: execution sees the dispatcher's services bag and the
 *      abort signal alongside the batch, not as ambient globals.
 *   2. Composable: output-port routing chains nodes into larger flows via the
 *      dispatcher's placement graph (the bind operation in Dagonizer terms).
 *   3. Total: every item is routed to one of the declared ports; nothing throws
 *      past the node boundary (per-item errors route to an error port).
 *
 * Extend `MonadicNode` directly to author a **batch-native** node — the
 * hot-path case where one `execute` call processes the whole batch and hits
 * shared caches across it. To author a **per-item** node, extend `ScalarNode`
 * (which extends this) and implement `executeOne`; the base owns the batch loop.
 *
 * Supplies the fields a node needs but that don't vary by domain: `contract`
 * (defaults to `EMPTY_CONTRACT_FRAGMENT`), `timeout` (defaults to
 * `Timeout.none()`), and `validate`/`destroy` defaults. Subclasses declare
 * `abstract readonly name`, `abstract readonly outputs`, and `abstract execute`.
 *
 * @typeParam TState    the node state the dispatcher threads through the batch.
 * @typeParam TOutput   the literal union of output port names. Narrows the
 *                      placement-routing surface at compile time.
 * @typeParam TServices the services bag shape. `undefined` for nodes that need
 *                      no service.
 */

import type { NodeInterface } from '../contracts/NodeInterface.js';
import { EMPTY_CONTRACT_FRAGMENT } from '../contracts/OperationContractFragment.js';
import type { OperationContractFragment } from '../contracts/OperationContractFragment.js';
import type { Batch } from '../entities/batch/Batch.js';
import type { RoutedBatch } from '../entities/batch/RoutedBatch.js';
import type { NodeContextInterface } from '../entities/node/NodeContext.js';
import { Timeout } from '../entities/Timeout.js';
import type { ValidationResult } from '../entities/validation/ValidationResult.js';
import type { NodeStateInterface } from '../NodeStateBase.js';


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
   */
  readonly timeout: Timeout = Timeout.none();

  /**
   * The one node contract: consume a batch and partition its items across the
   * declared output ports. Subclasses implement the whole-batch transform
   * directly (the monad). `ScalarNode` provides a per-item `executeOne` loop
   * over this for the common case.
   */
  abstract execute(
    batch: Batch<TState>,
    context: NodeContextInterface<TServices>,
  ): Promise<RoutedBatch<TOutput, TState>>;

  /**
   * Validate node configuration at flow registration time. Default
   * implementation returns a valid result with no errors. Subclasses override
   * to check their own invariants (e.g. required config fields).
   *
   * The `NodeInterface` contract keeps `validate?()` optional at the external
   * boundary; `MonadicNode` supplies a concrete required-with-default so every
   * subclass always has a validation method without needing a presence check.
   */
  validate(): ValidationResult {
    return { 'valid': true, 'errors': [] };
  }

  /**
   * Clean up resources when the dispatcher is destroyed. Default implementation
   * is a no-op. Subclasses override to release connections, timers, or other
   * held resources.
   *
   * The `NodeInterface` contract keeps `destroy?()` optional at the external
   * boundary; `MonadicNode` supplies a concrete required-with-default so every
   * subclass always has a destroy method without needing a presence check.
   */
  async destroy(): Promise<void> {
    // no-op default
  }
}
