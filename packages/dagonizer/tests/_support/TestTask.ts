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
 */

import type { DagTaskInterface } from '../../src/contracts/DagTaskInterface.js';
import type { ExecutionRequestType } from '../../src/entities/executor/ExecutionRequest.js';
import { NodeContext } from '../../src/entities/node/NodeContext.js';
import { Timeout } from '../../src/entities/Timeout.js';
import type { NodeStateBase, NodeStateInterface } from '../../src/NodeStateBase.js';

import { graphStateTransfer } from './GraphStateSupport.js';

export class TestTask {
  private constructor() { /* static class */ }

  /**
   * Build a minimal `DagTaskInterface` for use in tests that exercise
   * container/channel correlation paths.
   *
   * Defaults:
   *   - `dagName`       → `'test-dag'`
   *   - `placementPath` → `[]`
   *   - `timeout`       → `Timeout.none()`
   *
   * `toRequest()` snapshots the live state into a single-item wire request.
   *
   * @param correlationId - Correlation id used for response demuxing.
   * @param signal        - AbortSignal forwarded on the task context.
   * @param state         - Live state instance (caller supplies its typed state).
   */
  static of<TState extends NodeStateInterface = NodeStateBase>(
    correlationId: string,
    signal: AbortSignal,
    state: TState,
  ): DagTaskInterface {
    const dagName = 'test-dag';

    const context = NodeContext.create(dagName, 'test-node', signal);

    const task: DagTaskInterface = {
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
          'items':         [{ 'id': correlationId, 'graphState': graphStateTransfer(state) }],
          'timeoutMs':     null,
          correlationId,
        };
      },
    };

    return task;
  }
}
