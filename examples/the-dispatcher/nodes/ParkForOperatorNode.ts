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

import { Batch, MonadicNode, NodeOutput } from '@studnicky/dagonizer';
import type { ItemType, NodeContextType, NodeOutputType, RoutedBatchType, SchemaObjectType } from '@studnicky/dagonizer';

import type { DispatcherState } from '../DispatcherState.ts';

export class ParkForOperatorNode extends MonadicNode<DispatcherState, 'parked' | 'ready'> {
  readonly name = 'park-for-operator';
  readonly outputs = ['parked', 'ready'] as const;

  override get outputSchema(): Record<'parked' | 'ready', SchemaObjectType> {
    return {
      'parked': { 'type': 'object' },
      'ready':  { 'type': 'object' },
    };
  }

  override async execute(
    batch: Batch<DispatcherState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'parked' | 'ready', DispatcherState>> {
    const acc = new Map<'parked' | 'ready', ItemType<DispatcherState>[]>();

    for (const item of batch) {
      const result = this.routeItem(item.state);
      for (const error of result.errors) {
        item.state.collectError(error);
      }
      const bucket = acc.get(result.output);
      if (bucket === undefined) {
        acc.set(result.output, [item]);
      } else {
        bucket.push(item);
      }
    }

    const routed = new Map<'parked' | 'ready', Batch<DispatcherState>>();
    for (const [output, items] of acc) {
      routed.set(output, Batch.from(items));
    }
    return routed;
  }

  private routeItem(state: DispatcherState): NodeOutputType<'parked' | 'ready'> {
    if (state.response.length > 0) {
      // Operator has filled in the response; resume the flow.
      return NodeOutput.create('ready');
    }

    // First call: park and await human input.
    const correlationKey = 'escalation:' + Date.now().toString();
    state.park(correlationKey);
    return NodeOutput.create('parked');
  }
}
