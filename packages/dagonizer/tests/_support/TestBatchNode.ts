/**
 * TestBatchNode: shared static factory for building batch-native
 * (`MonadicNode`) test nodes — the whole-batch analogue of `TestNode.make`.
 *
 * The single source for non-trivial test nodes that need batch-level control:
 * fan-out (size-1 → N items), accumulation, predicate dispatch across a batch,
 * and re-convergence. Tests supply a `route` callback that receives the live
 * `Batch` (and node context) and returns a `RoutedBatchType`; the factory owns
 * the boilerplate `name`/`outputs`/`outputSchema`/`execute` wiring so no test
 * hand-rolls an inline `MonadicNode` subclass.
 *
 * `outputSchema` is declared once here, derived from `outputs` — every node the
 * factory produces satisfies the mandatory per-port contract with a loose
 * `{ type: 'object' }` fragment per port (sufficient for engine-mechanic tests).
 */

import type { NodeInterface, SchemaObjectType } from '../../src/contracts/NodeInterface.js';
import { MonadicNode } from '../../src/core/MonadicNode.js';
import type { Batch } from '../../src/entities/batch/Batch.js';
import type { RoutedBatchType } from '../../src/entities/batch/RoutedBatchType.js';
import type { NodeContextType } from '../../src/entities/node/NodeContext.js';
import type { NodeStateInterface } from '../../src/NodeStateBase.js';

export class TestBatchNode {
  private constructor() { /* static class */ }

  private static displayName(iri: string): string {
    const hashIndex = iri.lastIndexOf('#');
    if (hashIndex >= 0) return iri.slice(hashIndex + 1);
    const slashIndex = iri.lastIndexOf('/');
    if (slashIndex >= 0) return iri.slice(slashIndex + 1);
    const colonIndex = iri.lastIndexOf(':');
    return colonIndex >= 0 ? iri.slice(colonIndex + 1) : iri;
  }

  /**
   * Build a batch-native `NodeInterface<TState, TOutput>` whose `execute`
   * delegates to the supplied `route` callback. The callback receives the live
   * batch and the node context and returns the routed sub-batches.
   *
   * @param name    - Node IRI (must match the DAG placement `node` reference).
   * @param outputs - Declared output port tokens; the per-port schema is derived
   *                  from these.
   * @param route   - Whole-batch transform returning a `RoutedBatchType`
   *                  (sync or async).
   */
  static of<TState extends NodeStateInterface, TOutput extends string>(
    iri: string,
    outputs: readonly TOutput[],
    route: (
      batch: Batch<TState>,
      context: NodeContextType,
    ) => RoutedBatchType<TOutput, TState> | Promise<RoutedBatchType<TOutput, TState>>,
  ): NodeInterface<TState, TOutput> {
    const displayName = TestBatchNode.displayName(iri);
    class BatchNode extends MonadicNode<TState, TOutput> {
      override readonly '@id' = iri;
      override readonly name = displayName;
      override readonly outputs = outputs;

      override get outputSchema(): Record<string, SchemaObjectType> {
        const schema: Record<string, SchemaObjectType> = {};
        for (const port of outputs) schema[port] = { 'type': 'object' };
        return schema;
      }

      override execute(
        batch: Batch<TState>,
        context: NodeContextType,
      ): Promise<RoutedBatchType<TOutput, TState>> {
        return Promise.resolve(route(batch, context));
      }
    }

    return new BatchNode();
  }
}
