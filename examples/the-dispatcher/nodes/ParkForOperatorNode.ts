/**
 * ParkForOperatorNode: HITL suspension point.
 *
 * On FIRST call (state.response is empty):
 *   - Generates a correlationKey.
 *   - Calls state.park(correlationKey) to transition lifecycle → awaiting-input.
 *   - Routes 'parked' (intercepted by the engine; flow suspends).
 *
 * On RESUME call (state.response is non-empty, set by the human operator):
 *   - Routes 'ready' → send-response continues the flow normally.
 *
 * The 'parked' output is not wired in the DAG — the engine intercepts it
 * before routing and surfaces `result.parked` with the correlationKey and cursor.
 */

import { NodeOutputBuilder, ScalarNode } from '@studnicky/dagonizer';
import type { SchemaObjectType } from '@studnicky/dagonizer';

import type { DispatcherState } from '../DispatcherState.ts';

export class ParkForOperatorNode extends ScalarNode<DispatcherState, 'parked' | 'ready'> {
  readonly name = 'park-for-operator';
  readonly outputs = ['parked', 'ready'] as const;

  override get outputSchema(): Record<'parked' | 'ready', SchemaObjectType> {
    return {
      'parked': { 'type': 'object' },
      'ready':  { 'type': 'object' },
    };
  }

  protected override async executeOne(state: DispatcherState) {
    if (state.response.length > 0) {
      // Operator has filled in the response; resume the flow.
      return NodeOutputBuilder.of('ready');
    }

    // First call: park and await human input.
    const correlationKey = 'escalation:' + Date.now().toString();
    state.park(correlationKey);
    return NodeOutputBuilder.of('parked');
  }
}
