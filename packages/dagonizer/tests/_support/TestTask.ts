/**
 * TestTask: shared static factory for building minimal `DagTaskInterface`
 * instances in unit tests.
 *
 * Three files duplicated nearly identical `makeTask` freestanding functions
 * (batch-container-transport, channel-correlation, loopback-channel). All
 * three build a `DagTaskInterface` with:
 *
 *   - a caller-supplied `correlationId` and `AbortSignal`
 *   - `dagName: 'test-dag'`, `placementPath: []`, `timeout: Timeout.none()`
 *   - an optional `state` arg (defaults to `new MinimalState()` or a
 *     caller-supplied `TState` instance)
 *   - `toRequest()` that snapshots the state into a single-item request
 *
 * `TestTask.of` covers the correlation/loopback variant (state defaults to
 * a fresh `NodeStateBase`). When a test supplies its own typed state it
 * passes it as the third positional argument.
 *
 * The `services` type parameter follows the same convention as
 * `DagTaskInterface`: default `undefined` = no services bag.
 */

import type { DagTaskInterface } from '../../src/contracts/DagTaskInterface.js';
import type { ExecutionRequestType } from '../../src/entities/executor/ExecutionRequest.js';
import type { NodeContextType } from '../../src/entities/node/NodeContext.js';
import { Timeout } from '../../src/entities/Timeout.js';
import type { NodeStateBase, NodeStateInterface } from '../../src/NodeStateBase.js';

export class TestTask {
  private constructor() { /* static class */ }

  /**
   * Build a minimal `DagTaskInterface<TState, TServices>` for use in tests
   * that exercise container/channel correlation paths.
   *
   * Defaults:
   *   - `dagName`       → `'test-dag'`
   *   - `placementPath` → `[]`
   *   - `timeout`       → `Timeout.none()`
   *   - `services`      → `undefined`
   *
   * `toRequest()` snapshots the live state into a single-item wire request.
   *
   * @param correlationId - Correlation id used for response demuxing.
   * @param signal        - AbortSignal forwarded on the task context.
   * @param state         - Live state instance (caller supplies its typed state).
   */
  static of<
    TState extends NodeStateInterface = NodeStateBase,
    TServices = undefined,
  >(
    correlationId: string,
    signal: AbortSignal,
    state: TState,
  ): DagTaskInterface<TServices> {
    const dagName = 'test-dag';

    const context: NodeContextType<TServices> = {
      'signal':    signal,
      'dagName':   dagName,
      'nodeName':  'test-node',
      'services':  undefined as TServices,
    };

    const task: DagTaskInterface<TServices> = {
      'dagName':       dagName,
      'placementPath': [],
      correlationId,
      'timeout':       Timeout.none(),
      state,
      context,
      toRequest(): ExecutionRequestType {
        return {
          'dagName':       dagName,
          'placementPath': [],
          'items':         [{ 'id': correlationId, 'snapshot': state.snapshot() }],
          'timeoutMs':     null,
          correlationId,
        };
      },
    };

    return task;
  }
}
