/**
 * subclassing/dags: pure module — NodeStateBase subclasses and a retry-budget node.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/subclassing.ts (the executable entry point).
 */

import {
  Batch,
  MonadicNode,
  NodeOutput,
  NodeStateBase,
  RoutedBatch,
} from '@studnicky/dagonizer';
import type { NodeContextType, SchemaObjectType } from '@studnicky/dagonizer';
import type { JsonObjectType, JsonValueType } from '@studnicky/dagonizer/entities';

// ---------------------------------------------------------------------------
// Basic subclass
// ---------------------------------------------------------------------------

// #region basic-subclass
export class PipelineState extends NodeStateBase {
  items: string[] = [];
  processedIds = new Set<string>();
  totalCost = 0;
}
// #endregion basic-subclass

// ---------------------------------------------------------------------------
// Subclass with clone (manual copy, no super.clone())
// ---------------------------------------------------------------------------

interface Config {
  retries: number;
}

// #region clone-manual
class SharedConfigState extends NodeStateBase {
  items: string[] = [];
  config: Config = { retries: 3 };

  override clone(): this {
    const cloned = super.clone();
    cloned.config = this.config;
    cloned.items = [...this.items];
    return cloned;
  }
}
// #endregion clone-manual

export { SharedConfigState };

// ---------------------------------------------------------------------------
// Subclass with clone (delegate to super.clone())
// ---------------------------------------------------------------------------

// #region clone-super
class ItemListState extends NodeStateBase {
  items: string[] = [];

  override clone(): this {
    const base = super.clone();
    base.items = [...this.items];
    return base;
  }
}
// #endregion clone-super

export { ItemListState };

// ---------------------------------------------------------------------------
// Static restore
// ---------------------------------------------------------------------------

// #region static-restore
export class RestoredState extends NodeStateBase {
  items: string[] = [];

  // NodeStateBase.restore is static with this-polymorphism.
  // Subclasses inherit it; RestoredState.restore(snap) returns RestoredState.
  static demo(): void {
    const state = new RestoredState();
    const snap = state.snapshot();
    const restored = RestoredState.restore(snap);
    // restored is RestoredState (not NodeStateBase)
    if (!(restored instanceof RestoredState)) {
      throw new Error('restore did not return RestoredState');
    }
  }
}
// #endregion static-restore

// ---------------------------------------------------------------------------
// Retry budget: a node that routes via withinRetryBudget
// ---------------------------------------------------------------------------

// #region retry-budget-node
export class ApiState extends NodeStateBase {
  data: JsonValueType = null;

  protected override snapshotData(): JsonObjectType {
    return { data: this.data };
  }

  protected override restoreData(snap: JsonObjectType): void {
    this.data = snap['data'] ?? null;
  }
}

export class ApiNode extends MonadicNode<ApiState, 'success' | 'retry' | 'salvage'> {
  readonly name    = 'api';
  readonly outputs = ['success', 'retry', 'salvage'] as const;
  override get outputSchema(): Record<'success' | 'retry' | 'salvage', SchemaObjectType> {
    return { 'success': { 'type': 'object' }, 'retry': { 'type': 'object' }, 'salvage': { 'type': 'object' } };
  }

  override async execute(batch: Batch<ApiState>, context: NodeContextType) {
    const entries: Array<readonly ['success' | 'retry' | 'salvage', Batch<ApiState>]> = [];
    for (const item of batch) {
      const state = item.state;
      try {
        // Stub: production code would call an external service here.
        state.data = { ok: true };
        state.clearAttempts(context.nodeName);
        entries.push([NodeOutput.create('success').output, Batch.from([item])]);
      } catch {
        const canRetry = state.withinRetryBudget(context.nodeName, 3);
        const output = NodeOutput.create(canRetry ? 'retry' : 'salvage');
        entries.push([output.output, Batch.from([item])]);
      }
    }
    return RoutedBatch.create(entries);
  }
}
// #endregion retry-budget-node
