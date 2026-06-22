/**
 * PlaceholderNode: routes unconditionally to the first declared output.
 *
 * Use during development to stub a node that has not been implemented yet.
 * Every call produces a no-op state write and routes to the first output in
 * the declared `outputs` tuple. Replace with a concrete `ScalarNode` subclass
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
import type { NodeContextType } from '../entities/node/NodeContext.js';
import { NodeOutputBuilder } from '../entities/node/NodeOutput.js';
import type { NodeOutputType } from '../entities/node/NodeOutput.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

import { ScalarNode } from './ScalarNode.js';

export class PlaceholderNode<
  TState extends NodeStateInterface,
  TOutput extends string,
> extends ScalarNode<TState, TOutput> {
  readonly name: string;
  readonly outputs: readonly [TOutput, ...TOutput[]];

  constructor(name: string, outputs: readonly [TOutput, ...TOutput[]]) {
    super();
    this.name = name;
    this.outputs = outputs;
  }

  override get outputSchema(): Record<TOutput, SchemaObjectType> {
    const schema: Record<string, SchemaObjectType> = {};
    for (const port of this.outputs) schema[port] = { 'type': 'object' };
    return schema as Record<TOutput, SchemaObjectType>;
  }

  protected override async executeOne(
    state: TState,
    context: NodeContextType,
  ): Promise<NodeOutputType<TOutput>> {
    void state;
    void context;
    return NodeOutputBuilder.of(this.outputs[0]);
  }
}
