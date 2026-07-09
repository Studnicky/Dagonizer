/**
 * MonadicNode: the root of every node — the minimum viable node.
 *
 * A node is the monad of the engine: it consumes a `Batch<TState>` and returns
 * a `RoutedBatchType<TOutput, TState>`, partitioning the batch's items across its
 * declared output ports. That single operation is the one node contract
 * (`NodeInterface.execute`); `MonadicNode` is the abstract base that supplies
 * the boilerplate every node needs and leaves `execute` for the author to
 * implement. The "monadic" framing captures three traits the pattern taxonomy
 * depends on:
 *
 *   1. Context-carrying: execution sees the abort signal alongside the batch,
 *      not as an ambient global.
 *   2. Composable: output-port routing chains nodes into larger flows via the
 *      dispatcher's placement graph (the bind operation in Dagonizer terms).
 *   3. Total: every item is routed to one of the declared ports; nothing throws
 *      past the node boundary (per-item errors route to an error port).
 *
 * Extend `MonadicNode` to author every node. Nodes that operate on one item at
 * a time still receive a batch and own that routing logic locally; a size-1
 * batch is an input case, not a separate node shape.
 *
 * Supplies the fields a node needs but that don't vary by domain: `timeout`
 * (defaults to `Timeout.none()`), and `validate`/`destroy` defaults. Subclasses
 * declare `abstract readonly '@id'`, `abstract readonly name`,
 * `abstract readonly outputs`, and
 * `abstract execute`.
 *
 * @typeParam TState          the node state the dispatcher threads through the batch.
 * @typeParam TOutput         the literal union of output port names. Narrows the
 *                            placement-routing surface at compile time.
 * @typeParam TInputSchema    the literal JSON Schema accepted by the node.
 * @typeParam TOutputSchemas  the per-output literal JSON Schemas produced by the node.
 */

import type { NodeInterface, SchemaObjectType } from '../contracts/NodeInterface.js';
import type { Batch } from '../entities/batch/Batch.js';
import type { RoutedBatchType } from '../entities/batch/RoutedBatchType.js';
import type { NodeContextType } from '../entities/node/NodeContext.js';
import { Timeout } from '../entities/Timeout.js';
import type { ValidationResultType } from '../entities/validation/ValidationResult.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

const PERMISSIVE_STATE_SCHEMA = { 'type': 'object' } as const satisfies SchemaObjectType;

export abstract class MonadicNode<
  TState extends NodeStateInterface = NodeStateInterface,
  TOutput extends string = 'success' | 'empty' | 'error',
  TInputSchema extends SchemaObjectType = SchemaObjectType,
  TOutputSchemas extends Record<TOutput, SchemaObjectType> = Record<TOutput, SchemaObjectType>,
> implements NodeInterface<TState, TOutput, TInputSchema, TOutputSchemas> {
  static permissiveSchema<TOutput extends string>(
    outputs: readonly TOutput[],
  ): Record<TOutput, SchemaObjectType> {
    const schema: Record<string, SchemaObjectType> = {};
    for (const output of outputs) {
      schema[output] = PERMISSIVE_STATE_SCHEMA;
    }
    return schema;
  }

  /** Canonical node IRI used by the dispatcher registry. */
  abstract readonly '@id': string;

  /** Human-readable display name used for observability. */
  abstract readonly name: string;

  /** Literal union of output port names. Narrows placement routing. */
  abstract readonly outputs: readonly TOutput[];

  /**
   * Per-node wall-clock budget. `Timeout.none()` means no time limit.
   * Subclasses override to set a concrete budget via `Timeout.ofMs(n)`.
   */
  readonly timeout: Timeout = Timeout.none();

  /**
   * Default input contract for nodes without stronger structural requirements.
   * Subclasses override this getter when their incoming state has required
   * fields that graph validation can check before execution.
   */
  get inputSchema(): TInputSchema {
    return PERMISSIVE_STATE_SCHEMA as TInputSchema;
  }

  /**
   * Per-port output contract: a JSON Schema fragment for each declared output
   * port describing the state delta the node writes when it routes to that port.
   * `abstract` — there is no passthrough default. Every concrete node MUST
   * declare its return shapes; a node that omits this does not compile. This is
   * the engine's enforcement of the mandatory-contract rule (the compiler is the
   * check), and it keeps the node's data-flow statically legible to consumers
   * and to the opt-in `validateOutputs` lifecycle stage.
   */
  abstract get outputSchema(): TOutputSchemas;

  /**
   * The one node contract: consume a batch and partition its items across the
   * declared output ports. Subclasses implement the whole-batch transform
   * directly, including any local item-level routing the node requires.
   */
  abstract execute(
    batch: Batch<TState>,
    context: NodeContextType,
  ): Promise<RoutedBatchType<TOutput, TState>>;

  /**
   * Validate node configuration at flow registration time. Default
   * implementation returns a valid result with no errors. Subclasses override
   * to check their own invariants (e.g. required config fields).
   *
   * The `NodeInterface` contract keeps `validate?()` optional at the external
   * boundary; `MonadicNode` supplies a concrete required-with-default so every
   * subclass always has a validation method without needing a presence check.
   */
  validate(): ValidationResultType {
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
