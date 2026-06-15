/**
 * TestNode: shared static factory for building minimal `NodeInterface`
 * instances in unit tests.
 *
 * Replaces the 6+ copies of the `makeNode` freestanding helper that existed
 * across test files. Every test that needs a trivial node should use
 * `TestNode.make(name, outputs, exec?)` rather than defining a local helper.
 */

import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import type { OperationContractFragment } from '../../src/contracts/OperationContractFragment.js';
import { ScalarNode } from '../../src/core/ScalarNode.js';
import type { NodeContextInterface } from '../../src/entities/node/NodeContext.js';
import type { NodeOutputInterface } from '../../src/entities/node/NodeOutput.js';
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
   * @param exec     - Optional callback receiving `(state)` and returning a token
   *                   string (sync or async). Defaults to `() => outputs[0]`.
   */
  static make<TState extends NodeStateInterface>(
    name: string,
    outputs: readonly string[],
    exec?: (state: TState) => string | Promise<string>,
  ): NodeInterface<TState> {
    const defaultOutput = outputs[0] as string;

    class MakeNode extends ScalarNode<TState, string> {
      override readonly name = name;
      override readonly outputs = outputs as readonly string[];

      override async executeOne(
        state: TState,
        _context: NodeContextInterface,
      ): Promise<NodeOutputInterface<string>> {
        const output = exec !== undefined ? await exec(state) : defaultOutput;
        return NodeOutputBuilder.of(output);
      }
    }

    return new MakeNode();
  }

  /**
   * Create a minimal `NodeInterface<TState>` with an `OperationContractFragment`
   * attached. Nodes always return `outputs[0]`; the contract is the fixture under
   * test (consumed by `DAGBuilder.contract()` validation).
   *
   * @param name     - Node name.
   * @param outputs  - Declared output tokens; `outputs[0]` is the only route.
   * @param contract - Contract fragment to attach.
   */
  static withContract<TState extends NodeStateInterface>(
    name: string,
    outputs: readonly string[],
    contract: OperationContractFragment,
  ): NodeInterface<TState, string> {
    const defaultOutput = outputs[0] ?? 'success';

    class WithContractNode extends ScalarNode<TState, string> {
      override readonly name = name;
      override readonly outputs = outputs as readonly string[];
      override readonly contract: OperationContractFragment = contract;

      override async executeOne(
        _state: TState,
        _context: NodeContextInterface,
      ): Promise<NodeOutputInterface<string>> {
        return NodeOutputBuilder.of(defaultOutput);
      }
    }

    return new WithContractNode();
  }
}
