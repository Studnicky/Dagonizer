/**
 * ScalarNode: the per-item specialization of `MonadicNode`.
 *
 * Extends the `MonadicNode` root and implements its `execute(batch)` contract
 * by looping a per-item `executeOne` over the batch — "a scalar is a batch of
 * one." Subclasses implement `executeOne` with the per-item signature; the base
 * maps it over the batch, forwards per-item errors via `state.collectError`,
 * and groups items by the returned output port into a `RoutedBatchType`.
 *
 * Use `ScalarNode` for the common per-item leaf node (LLM/IO leaves, most
 * domain nodes). Author a batch-native hot-path node by extending `MonadicNode`
 * directly and implementing `execute`.
 */

import type { SchemaObjectType } from '../contracts/NodeInterface.js';
import { Batch } from '../entities/batch/Batch.js';
import type { ItemType } from '../entities/batch/Item.js';
import type { RoutedBatchType } from '../entities/batch/RoutedBatchType.js';
import type { NodeContextType } from '../entities/node/NodeContext.js';
import type { NodeOutputType } from '../entities/node/NodeOutput.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

import { MonadicNode } from './MonadicNode.js';

/** The permissive per-port schema `ScalarNode.permissiveSchema` writes for every listed output. */
const PERMISSIVE_PORT_SCHEMA: SchemaObjectType = { 'type': 'object' };

export abstract class ScalarNode<
  TState extends NodeStateInterface,
  TOutput extends string,
> extends MonadicNode<TState, TOutput> {
  /**
   * Convenience for nodes that don't need per-output-port validation: builds
   * an `outputSchema` record with `{ type: 'object' }` for every listed output
   * name, in place of hand-writing the boilerplate record literal.
   *
   * @example
   * ```ts
   * override get outputSchema() { return ScalarNode.permissiveSchema(this.outputs); }
   * ```
   */
  static permissiveSchema<TOutput extends string>(
    outputs: readonly TOutput[],
  ): Record<TOutput, SchemaObjectType> {
    const schema: Record<string, SchemaObjectType> = {};
    for (const output of outputs) {
      schema[output] = PERMISSIVE_PORT_SCHEMA;
    }
    return schema;
  }

  /**
   * Per-item execution. Subclasses implement this; the base class maps it over
   * the batch and groups items by the returned output port.
   */
  protected abstract executeOne(
    state: TState,
    context: NodeContextType,
  ): Promise<NodeOutputType<TOutput>>;

  /**
   * Iterates items in order, calls `executeOne` for each, forwards errors via
   * `state.collectError`, groups items by the returned output port, and returns
   * a `RoutedBatchType`. Output-schema validation is applied at the engine
   * dispatch funnel (`OutputContractApplier.applyToRouted`) after this method
   * returns, covering both `ScalarNode` and `MonadicNode` subclasses uniformly.
   */
  override async execute(
    batch: Batch<TState>,
    context: NodeContextType,
  ): Promise<RoutedBatchType<TOutput, TState>> {
    const acc = new Map<TOutput, ItemType<TState>[]>();

    for (const item of batch) {
      const result = await this.executeOne(item.state, context);
      for (const err of result.errors) {
        item.state.collectError(err);
      }
      const bucket = acc.get(result.output);
      if (bucket !== undefined) {
        bucket.push(item);
      } else {
        acc.set(result.output, [item]);
      }
    }

    const routed = new Map<TOutput, Batch<TState>>();
    for (const [output, items] of acc) {
      routed.set(output, Batch.from(items));
    }
    return routed;
  }
}
