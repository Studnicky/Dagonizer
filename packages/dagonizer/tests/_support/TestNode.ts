/**
 * TestNode: shared static factory for building minimal `NodeInterface`
 * instances in unit tests.
 *
 * Replaces the 6+ copies of the `makeNode` freestanding helper that existed
 * across test files. Every test that needs a trivial node should use
 * `TestNode.make(name, outputs, exec?)` rather than defining a local helper.
 */

import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { EMPTY_CONTRACT_FRAGMENT } from '../../src/contracts/OperationContractFragment.js';
import type { OperationContractFragment } from '../../src/contracts/OperationContractFragment.js';
import { Batch } from '../../src/core/batch/Batch.js';
import type { Item } from '../../src/core/batch/Item.js';
import type { RoutedBatch } from '../../src/core/batch/RoutedBatch.js';
import type { NodeStateInterface } from '../../src/NodeStateBase.js';
import { Timeout } from '../../src/runtime/Timeout.js';

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
    return {
      name,
      outputs,
      'contract': EMPTY_CONTRACT_FRAGMENT,
      'timeout': Timeout.none(),
      async execute(batch: Batch<TState>): Promise<RoutedBatch<string, TState>> {
        const acc = new Map<string, Item<TState>[]>();
        for (const item of batch) {
          const output = exec !== undefined ? await exec(item.state) : defaultOutput;
          const bucket = acc.get(output);
          if (bucket !== undefined) { bucket.push(item); } else { acc.set(output, [item]); }
        }
        const routed = new Map<string, Batch<TState>>();
        for (const [key, items] of acc) { routed.set(key, Batch.from(items)); }
        return routed;
      },
    };
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
    return {
      name,
      outputs,
      contract,
      'timeout': Timeout.none(),
      async execute(batch: Batch<TState>): Promise<RoutedBatch<string, TState>> {
        const acc = new Map<string, Item<TState>[]>();
        for (const item of batch) {
          const bucket = acc.get(defaultOutput);
          if (bucket !== undefined) { bucket.push(item); } else { acc.set(defaultOutput, [item]); }
        }
        const routed = new Map<string, Batch<TState>>();
        for (const [key, items] of acc) { routed.set(key, Batch.from(items)); }
        return routed;
      },
    };
  }
}
