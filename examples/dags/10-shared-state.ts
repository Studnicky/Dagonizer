/**
 * 10-shared-state/dags: pure module — services interface, nodes, and DAG consts.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/10-shared-state.ts (the executable entry point).
 */

import {
  DAGBuilder,
  NodeOutputBuilder,
  NodeStateBase,
  ScalarNode,
} from '@studnicky/dagonizer';
import type { NodeContextType, SchemaObjectType } from '@studnicky/dagonizer';
import { MemoryStore } from '@studnicky/dagonizer/store';
import type { StoreInterface } from '@studnicky/dagonizer/contracts';

// ---------------------------------------------------------------------------
// Services record type
// ---------------------------------------------------------------------------

// #region services
export interface Services {
  log: StoreInterface;
}
// #endregion services

// ---------------------------------------------------------------------------
// Nodes: each appends its own name to the store's 'entries' key
// ---------------------------------------------------------------------------

export class StepANode extends ScalarNode<NodeStateBase, 'done', Services> {
  readonly name = 'step-a';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  protected override async executeOne(_state: NodeStateBase, context: NodeContextType<Services>) {
    await context.services.log.update<string>('entries', (current) => {
      const existing = current?.split(',').filter(Boolean) ?? [];
      return [...existing, 'step-a'].join(',');
    });
    return NodeOutputBuilder.of('done');
  }
}

export class StepBNode extends ScalarNode<NodeStateBase, 'done', Services> {
  readonly name = 'step-b';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  protected override async executeOne(_state: NodeStateBase, context: NodeContextType<Services>) {
    await context.services.log.update<string>('entries', (current) => {
      const existing = current?.split(',').filter(Boolean) ?? [];
      return [...existing, 'step-b'].join(',');
    });
    return NodeOutputBuilder.of('done');
  }
}

export class ChildStepNode extends ScalarNode<NodeStateBase, 'done', Services> {
  readonly name = 'child-step';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  protected override async executeOne(_state: NodeStateBase, context: NodeContextType<Services>) {
    await context.services.log.update<string>('entries', (current) => {
      const existing = current?.split(',').filter(Boolean) ?? [];
      return [...existing, 'child-step'].join(',');
    });
    return NodeOutputBuilder.of('done');
  }
}

// ---------------------------------------------------------------------------
// DAGs: child DAG placed inside the parent
// ---------------------------------------------------------------------------

const childStepNode = new ChildStepNode();

// #region child-dag
export const childDag = new DAGBuilder('sub-flow', '1')
  .node('child-step', childStepNode, { "done": 'child-end' })
  .terminal('child-end')
  .build();
// #endregion child-dag

const stepANode = new StepANode();
const stepBNode = new StepBNode();

// #region parent-dag
// run-child is an EmbeddedDAGNode whose body is the registered 'sub-flow' DAG.
// The child shares the same services record, so child-step appends to the same
// MemoryStore between step-a and step-b.
export const parentDag = new DAGBuilder('main-flow', '1')
  .node('step-a', stepANode, { "done": 'run-child' })
  .embeddedDAG('run-child', 'sub-flow', { "success": 'step-b', "error": 'step-b' })
  .node('step-b', stepBNode, { "done": 'end' })
  .terminal('end')
  .build();
// #endregion parent-dag

// Re-export MemoryStore so the executable entry point can import it from here
// without adding a second direct import of the store subpath.
export { MemoryStore };

// ---------------------------------------------------------------------------
// TypedStore: schema-narrowed wrapper
// ---------------------------------------------------------------------------

// #region typed-store
import { TypedStore } from '@studnicky/dagonizer/store';

interface PipelineSchema {
  tokenBudget:  number;
  messages:     string[];
  lastNodeName: string;
}

export async function typedStoreDemo(): Promise<void> {
  const inner = new MemoryStore();
  const typed = new TypedStore<PipelineSchema>(inner);

  await typed.set('tokenBudget', 4096);
  const budget = await typed.get('tokenBudget');   // number | null
  await typed.update('messages', (msgs) => [...(msgs ?? []), 'hello']);

  // TypeScript rejects wrong keys and wrong value types at compile time.
  // await typed.set('unknown', 'x');              // TS error: key not in schema
  // await typed.set('tokenBudget', 'not a num');  // TS error: expected number

  const raw: StoreInterface = typed.inner;
  await raw.set<boolean>('someFlag', true);
  void budget;
}
// #endregion typed-store

// ---------------------------------------------------------------------------
// StoreInterface concurrency: lost-update vs atomic update
// ---------------------------------------------------------------------------

// #region store-concurrency
export async function storeConcurrencyDemo(): Promise<void> {
  const store = new MemoryStore();

  // Race: two paths increment independently. Both read 0, both write 1. Final: 1 (lost update).
  const current = await store.get<number>('counter') ?? 0;
  await store.set<number>('counter', current + 1);

  // Atomic: update holds the RMW as one indivisible operation. Final: 2.
  await store.update<number>('counter', (n) => (n ?? 0) + 1);
  await store.update<number>('counter', (n) => (n ?? 0) + 1);
}
// #endregion store-concurrency

// ---------------------------------------------------------------------------
// StoreError discrimination
// ---------------------------------------------------------------------------

// #region store-error-discrimination
import { StoreError } from '@studnicky/dagonizer/store';
import type { RemoteStoreInterface } from '@studnicky/dagonizer/contracts';

export async function storeErrorDemo(store: RemoteStoreInterface): Promise<void> {
  try {
    await store.acquireLease('run-abc', 5_000, 1_000);
  } catch (err) {
    if (err instanceof StoreError && err.classification.reason === 'LEASE_DENIED') {
      const { subject, holder } = err.classification;
      process.stdout.write(`lease for ${subject} held by ${holder}\n`);
    }
  }
}
// #endregion store-error-discrimination

// ---------------------------------------------------------------------------
// Services node: reads from context.services record
// ---------------------------------------------------------------------------

// #region services-node
interface AppServices {
  logger: { info(msg: string): void; error(meta: object, msg: string): void };
  cache:  { get(key: string): Promise<unknown> };
  db:     { query(sql: string): Promise<unknown> };
}

export class DbFetchNode extends ScalarNode<NodeStateBase, 'success' | 'error', AppServices> {
  readonly name    = 'db-fetch';
  readonly outputs = ['success', 'error'] as const;
  override get outputSchema(): Record<'success' | 'error', SchemaObjectType> {
    return { 'success': { 'type': 'object' }, 'error': { 'type': 'object' } };
  }

  protected override async executeOne(_state: NodeStateBase, context: NodeContextType<AppServices>): Promise<ReturnType<typeof NodeOutputBuilder.of<'success' | 'error'>>> {
    context.services.logger.info('fetch start');
    const cached = await context.services.cache.get('key');
    if (cached !== null) {
      return NodeOutputBuilder.of('success');
    }
    try {
      await context.services.db.query('SELECT 1');
      return NodeOutputBuilder.of('success');
    } catch (error) {
      context.services.logger.error({ err: error }, 'fetch failed');
      return NodeOutputBuilder.of('error');
    }
  }
}
// #endregion services-node
