/**
 * PlaceholderNode: routes unconditionally to the first declared output.
 *
 * Use during development to stub a node that has not been implemented yet.
 * Every call produces a no-op state write and routes to the first output in
 * the declared `outputs` tuple. Replace with a concrete `MonadicNode` subclass
 * when the business logic is ready.
 *
 * @example
 * ```ts
 * // Quick stub during authoring:
 * const node = new PlaceholderNode('classify', ['success', 'error']);
 * // node.execute() always routes → 'success'
 * ```
 */

import type { SchemaObjectType } from '../contracts/NodeInterface.js';
import type { Batch } from '../entities/batch/Batch.js';
import type { RoutedBatchType } from '../entities/batch/RoutedBatchType.js';
import type { NodeContextType } from '../entities/node/NodeContext.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

import { MonadicNode } from './MonadicNode.js';

export class PlaceholderNode<
  TState extends NodeStateInterface,
  TOutput extends string,
> extends MonadicNode<TState, TOutput> {
  readonly name: string;
  readonly outputs: readonly [TOutput, ...TOutput[]];

  constructor(name: string, outputs: readonly [TOutput, ...TOutput[]]) {
    super();
    this.name = name;
    this.outputs = outputs;
  }

  override get outputSchema(): Record<string, SchemaObjectType> {
    const schema: Record<string, SchemaObjectType> = {};
    for (const port of this.outputs) schema[port] = { 'type': 'object' };
    return schema;
  }

  override async execute(
    batch: Batch<TState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<TOutput, TState>> {
    return new Map([[this.outputs[0], batch]]);
  }
}
