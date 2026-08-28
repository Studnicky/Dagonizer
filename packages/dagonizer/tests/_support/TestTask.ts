/**
 * TestTask: shared static factory for building minimal `DagTaskType`
 * instances in unit tests.
 *
 * Three files duplicated nearly identical `makeTask` freestanding functions
 * (batch-container-transport, channel-correlation, loopback-channel). All
 * three build a `DagTaskType` with:
 *
 *   - a caller-supplied `correlationId` and `AbortSignal`
 *   - `dagName: 'test-dag'`, `placementPath: []`, `timeout: Timeout.none()`
 *   - an optional `state` arg (defaults to `new MinimalState()` or a
 *     caller-supplied `TState` instance)
 *
 * `TestTask.of` covers the correlation/loopback variant (state defaults to
 * a fresh `NodeStateBase`). When a test supplies its own typed state it
 * passes it as the third positional argument.
 */

import { NodeContext } from '../../src/entities/node/NodeContext.js';
import { Timeout } from '../../src/entities/Timeout.js';
import type { NodeStateBase, NodeStateInterface } from '../../src/NodeStateBase.js';
import type { DagTaskType } from '../../src/types/DagTask.js';

import { FULL_INPUT_STATE, FULL_RESPONSE_STATE } from './GraphStateSupport.js';

export class TestTask {
  private constructor() { /* static class */ }

  /**
   * Build a minimal `DagTaskType` for use in tests that exercise
   * container/channel correlation paths.
   *
   * Defaults:
   *   - `dagName`       → `'test-dag'`
   *   - `placementPath` → `[]`
   *   - `timeout`       → `Timeout.none()`
   *
   * @param correlationId - Correlation id used for response demuxing.
   * @param signal        - AbortSignal forwarded on the task context.
   * @param state         - Live state instance (caller supplies its typed state).
   */
  static of<TState extends NodeStateInterface = NodeStateBase>(
    correlationId: string,
    signal: AbortSignal,
    state: TState,
  ): DagTaskType {
    const dagName = 'test-dag';

    const context = NodeContext.create(dagName, 'test-node', signal);

    const task: DagTaskType = {
      'dagName':       dagName,
      'placementPath': [],
      correlationId,
      'timeout':       Timeout.none(),
      state,
      'inputState':    FULL_INPUT_STATE,
      'responseState': FULL_RESPONSE_STATE,
      context,
    };

    return task;
  }
}
