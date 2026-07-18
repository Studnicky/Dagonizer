import { Batch } from '@studnicky/dagonizer';
import type {
  Dagonizer,
  ExecuteOptionsType,
  ExecutionResultType,
  ItemIdType,
  ItemType,
  ParkedType,
} from '@studnicky/dagonizer';

import type { DispatcherState } from '../DispatcherState.ts';

interface DispatcherBatchPartition {
  readonly terminalOutcome: 'completed' | 'failed' | null;
  readonly terminalOutcomeByItemId: ReadonlyMap<ItemIdType, 'completed' | 'failed'>;
  readonly completed: readonly ItemType<DispatcherState>[];
  readonly failed: readonly ItemType<DispatcherState>[];
  readonly awaitingInput: readonly ItemType<DispatcherState>[];
  readonly parked: ParkedType | null;
  readonly executedNodes: readonly string[];
}

/** Runs one scheduler workset and partitions its caller-owned Dispatcher states. */
export class DispatcherBatchDispatch {
  private constructor() {}

  static async run(
    dispatcher: Dagonizer<DispatcherState>,
    dagName: string,
    items: readonly ItemType<DispatcherState>[],
    options: ExecuteOptionsType = {},
  ): Promise<DispatcherBatchPartition> {
    if (items.length === 0) {
      throw new Error('DispatcherBatchDispatch.run requires at least one item');
    }
    const terminalOutcomeByItemId = new Map<ItemIdType, 'completed' | 'failed'>();
    const result = await dispatcher.executeBatch(
      dagName,
      Batch.from(items),
      terminalOutcomeByItemId,
      options,
    );
    return DispatcherBatchDispatch.partition(items, result, terminalOutcomeByItemId);
  }

  static async resume(
    dispatcher: Dagonizer<DispatcherState>,
    dagName: string,
    item: ItemType<DispatcherState>,
    cursor: string,
    options: ExecuteOptionsType = {},
  ): Promise<DispatcherBatchPartition> {
    const result = await dispatcher.resume(dagName, item.state, cursor, options);
    const terminalOutcomeByItemId = new Map<ItemIdType, 'completed' | 'failed'>();
    if (result.terminalOutcome !== null) {
      terminalOutcomeByItemId.set(item.id, result.terminalOutcome);
    }
    return DispatcherBatchDispatch.partition([item], result, terminalOutcomeByItemId);
  }

  private static partition(
    items: readonly ItemType<DispatcherState>[],
    result: ExecutionResultType<DispatcherState>,
    terminalOutcomeByItemId: ReadonlyMap<ItemIdType, 'completed' | 'failed'>,
  ): DispatcherBatchPartition {
    const partitionOutcomeByItemId = new Map(terminalOutcomeByItemId);
    const completed: ItemType<DispatcherState>[] = [];
    const failed: ItemType<DispatcherState>[] = [];
    const awaitingInput: ItemType<DispatcherState>[] = [];

    for (const item of items) {
      const lifecycle = item.state.lifecycle.variant;
      const terminalOutcome = terminalOutcomeByItemId.get(item.id)
        ?? (lifecycle === 'completed' || lifecycle === 'failed' ? lifecycle : undefined);
      if (terminalOutcome !== undefined) {
        partitionOutcomeByItemId.set(item.id, terminalOutcome);
      }
      if (terminalOutcome === 'completed') completed.push(item);
      if (terminalOutcome === 'failed') failed.push(item);
      if (item.state.lifecycle.variant === 'awaiting-input') awaitingInput.push(item);
    }

    const terminalOutcome = completed.length === items.length
      ? 'completed'
      : failed.length === items.length
        ? 'failed'
        : result.terminalOutcome;
    return {
      terminalOutcome,
      'terminalOutcomeByItemId': partitionOutcomeByItemId,
      completed,
      failed,
      awaitingInput,
      'parked': result.parked,
      'executedNodes': result.executedNodes,
    };
  }
}
