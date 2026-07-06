/**
 * TestNode: shared static factory for building minimal `NodeInterface`
 * instances in unit tests.
 *
 * The single source for trivial test nodes across test files. Every test that
 * needs a trivial node uses `TestNode.make(name, outputs, exec?)` rather than
 * defining a local helper.
 */

import type { NodeInterface, SchemaObjectType } from '../../src/contracts/NodeInterface.js';
import { MonadicNode } from '../../src/core/MonadicNode.js';
import { Batch } from '../../src/entities/batch/Batch.js';
import type { ItemType } from '../../src/entities/batch/Item.js';
import type { RoutedBatchType } from '../../src/entities/batch/RoutedBatchType.js';
import type { NodeContextType } from '../../src/entities/node/NodeContext.js';
import { NodeOutput } from '../../src/entities/node/NodeOutput.js';
import type { NodeStateInterface } from '../../src/NodeStateBase.js';

export class TestNode {
  private constructor() { /* static class */ }

  /**
   * Create a minimal `NodeInterface<TState>` that returns `outputs[0]`
   * by default, or invokes the optional `exec` callback and returns its result
   * as the output token.
   *
   * @param name     - Node name (must match the DAG placement `node` reference).
   * @param outputs  - Declared output tokens; `outputs[0]` is the default route.
   * @param exec     - Optional callback receiving `(state, context)` and
   *                   returning a token string (sync or async). The context
   *                   gives access to the abort signal for nodes that sleep or
   *                   abort. Defaults to `() => outputs[0]`.
   */
  static make<TState extends NodeStateInterface>(
    name: string,
    outputs: readonly string[],
    exec?: (state: TState, context: NodeContextType) => string | Promise<string>,
  ): NodeInterface<TState> {
    const first = outputs[0];
    const defaultOutput = first !== undefined ? first : '';

    class MakeNode extends MonadicNode<TState, string> {
      override readonly name = name;
      override readonly outputs = outputs;

      override get outputSchema(): Record<string, SchemaObjectType> {
        const schema: Record<string, SchemaObjectType> = {};
        for (const port of this.outputs) schema[port] = { 'type': 'object' };
        return schema;
      }

      override async execute(
        batch: Batch<TState>,
        context: NodeContextType,
      ): Promise<RoutedBatchType<string, TState>> {
        const routedItems = new Map<string, ItemType<TState>[]>();
        for (const item of batch) {
          const output = exec !== undefined ? await exec(item.state, context) : defaultOutput;
          const result = NodeOutput.create(output);
          for (const error of result.errors) item.state.collectError(error);
          const bucket = routedItems.get(result.output);
          if (bucket !== undefined) {
            bucket.push(item);
          } else {
            routedItems.set(result.output, [item]);
          }
        }

        const routed = new Map<string, Batch<TState>>();
        for (const [output, items] of routedItems) {
          routed.set(output, Batch.from(items));
        }
        return routed;
      }
    }

    return new MakeNode();
  }
}
