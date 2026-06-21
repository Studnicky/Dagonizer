/**
 * TestNode: shared static factory for building minimal `NodeInterface`
 * instances in unit tests.
 *
 * The single source for trivial test nodes across test files. Every test that
 * needs a trivial node uses `TestNode.make(name, outputs, exec?)` rather than
 * defining a local helper.
 */

import type { NodeInterface, SchemaObjectType } from '../../src/contracts/NodeInterface.js';
import { ScalarNode } from '../../src/core/ScalarNode.js';
import type { NodeContextType } from '../../src/entities/node/NodeContext.js';
import type { NodeOutputType } from '../../src/entities/node/NodeOutput.js';
import { NodeOutputBuilder } from '../../src/entities/node/NodeOutput.js';
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
   *                   gives access to the abort signal and services for nodes
   *                   that sleep, abort, or read `context.services`. Defaults to
   *                   `() => outputs[0]`.
   */
  static make<TState extends NodeStateInterface>(
    name: string,
    outputs: readonly string[],
    exec?: (state: TState, context: NodeContextType) => string | Promise<string>,
  ): NodeInterface<TState> {
    const first = outputs[0];
    const defaultOutput = first !== undefined ? first : '';

    class MakeNode extends ScalarNode<TState, string> {
      override readonly name = name;
      override readonly outputs = outputs;

      override get outputSchema(): Record<string, SchemaObjectType> {
        const schema: Record<string, SchemaObjectType> = {};
        for (const port of this.outputs) schema[port] = { 'type': 'object' };
        return schema;
      }

      override async executeOne(
        state: TState,
        context: NodeContextType,
      ): Promise<NodeOutputType<string>> {
        const output = exec !== undefined ? await exec(state, context) : defaultOutput;
        return NodeOutputBuilder.of(output);
      }
    }

    return new MakeNode();
  }
}
