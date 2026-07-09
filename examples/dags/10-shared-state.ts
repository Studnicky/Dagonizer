/**
 * 10-shared-state/dags: pure module — nodes, and DAG consts.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/10-shared-state.ts (the executable entry point).
 */

import {
  Batch,
  DAG_CONTEXT,
  MonadicNode,
  NodeOutput,
  NodeStateBase,
  RoutedBatch,
  Validator,
} from '@studnicky/dagonizer';
import type { DAGType, SchemaObjectType } from '@studnicky/dagonizer';
import { MemoryStore } from '@studnicky/dagonizer/store';
import type { StoreInterface } from '@studnicky/dagonizer/contracts';

// ---------------------------------------------------------------------------
// Nodes: each appends its own name to the store's 'entries' key
// ---------------------------------------------------------------------------

export class StepANode extends MonadicNode<NodeStateBase, 'done'> {
  private readonly log: StoreInterface;
  readonly name = 'step-a';
  readonly '@id' = 'urn:noocodec:node:step-a';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  constructor(log: StoreInterface) {
    super();
    this.log = log;
  }

  override async execute(batch: Batch<NodeStateBase>) {
    await this.log.update('entries', (current) => {
      const existing = (typeof current === 'string' ? current : '').split(',').filter(Boolean);
      return [...existing, 'step-a'].join(',');
    });
    return RoutedBatch.create(NodeOutput.create('done').output, batch);
  }
}

export class StepBNode extends MonadicNode<NodeStateBase, 'done'> {
  private readonly log: StoreInterface;
  readonly name = 'step-b';
  readonly '@id' = 'urn:noocodec:node:step-b';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  constructor(log: StoreInterface) {
    super();
    this.log = log;
  }

  override async execute(batch: Batch<NodeStateBase>) {
    await this.log.update('entries', (current) => {
      const existing = (typeof current === 'string' ? current : '').split(',').filter(Boolean);
      return [...existing, 'step-b'].join(',');
    });
    return RoutedBatch.create(NodeOutput.create('done').output, batch);
  }
}

export class ChildStepNode extends MonadicNode<NodeStateBase, 'done'> {
  private readonly log: StoreInterface;
  readonly name = 'child-step';
  readonly '@id' = 'urn:noocodec:node:child-step';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  constructor(log: StoreInterface) {
    super();
    this.log = log;
  }

  override async execute(batch: Batch<NodeStateBase>) {
    await this.log.update('entries', (current) => {
      const existing = (typeof current === 'string' ? current : '').split(',').filter(Boolean);
      return [...existing, 'child-step'].join(',');
    });
    return RoutedBatch.create(NodeOutput.create('done').output, batch);
  }
}

// ---------------------------------------------------------------------------
// DAGs: child DAG placed inside the parent
// ---------------------------------------------------------------------------

// #region child-dag
export const childDag: DAGType = {
  '@context':   DAG_CONTEXT,
  '@id': 'urn:noocodec:dag:sub-flow',
  '@type':      'DAG',
  "name":       'sub-flow',
  "version":    '1',
  "entrypoints": { "main": 'urn:noocodec:dag:sub-flow/node/child-step' },
  "nodes": [
    {
      '@id': 'urn:noocodec:dag:sub-flow/node/child-step',
      '@type':   'SingleNode',
      "name":    'child-step',
      "node":    'urn:noocodec:node:child-step',
      "outputs": { "done": 'urn:noocodec:dag:sub-flow/node/child-end' },
    },
    {
      '@id': 'urn:noocodec:dag:sub-flow/node/child-end',
      '@type':   'TerminalNode',
      "name":    'child-end',
      "outcome": 'completed',
    },
  ],
};
// #endregion child-dag

// #region parent-dag
// run-child is an EmbeddedDAGNode whose body is the registered 'sub-flow' DAG.
// The child uses the same injected log store, so child-step appends to the same
// MemoryStore between step-a and step-b.
export const parentDag: DAGType = {
  '@context':   DAG_CONTEXT,
  '@id': 'urn:noocodec:dag:main-flow',
  '@type':      'DAG',
  "name":       'main-flow',
  "version":    '1',
  "entrypoints": { "main": 'urn:noocodec:dag:main-flow/node/step-a' },
  "nodes": [
    {
      '@id': 'urn:noocodec:dag:main-flow/node/step-a',
      '@type':   'SingleNode',
      "name":    'step-a',
      "node":    'urn:noocodec:node:step-a',
      "outputs": { "done": 'urn:noocodec:dag:main-flow/node/run-child' },
    },
    {
      '@id': 'urn:noocodec:dag:main-flow/node/run-child',
      '@type':       'EmbeddedDAGNode',
      "name":        'run-child',
      "dag":         'urn:noocodec:dag:sub-flow',
      "outputs":     {
        "success": 'urn:noocodec:dag:main-flow/node/step-b',
        "error": 'urn:noocodec:dag:main-flow/node/step-b',
      },
    },
    {
      '@id': 'urn:noocodec:dag:main-flow/node/step-b',
      '@type':   'SingleNode',
      "name":    'step-b',
      "node":    'urn:noocodec:node:step-b',
      "outputs": { "done": 'urn:noocodec:dag:main-flow/node/end' },
    },
    {
      '@id': 'urn:noocodec:dag:main-flow/node/end',
      '@type':   'TerminalNode',
      "name":    'end',
      "outcome": 'completed',
    },
  ],
};
// #endregion parent-dag

// Re-export MemoryStore so the executable entry point can import it from here
// without adding a second direct import of the store subpath.
export { MemoryStore };

// ---------------------------------------------------------------------------
// TypedStore: schema-narrowed wrapper
// ---------------------------------------------------------------------------

// #region typed-store
import { TypedStore } from '@studnicky/dagonizer/store';
import { StoreError } from '@studnicky/dagonizer/store';
import type { RemoteStoreInterface } from '@studnicky/dagonizer/contracts';

interface PipelineSchema {
  tokenBudget:  number;
  messages:     string[];
  lastNodeName: string;
}

const PipelineTokenBudgetSchema = { '$id': 'urn:example:PipelineSchema/tokenBudget', 'type': 'number' } as const;
const PipelineMessagesSchema    = { '$id': 'urn:example:PipelineSchema/messages', 'type': 'array', 'items': { 'type': 'string' } } as const;
const PipelineLastNodeNameSchema = { '$id': 'urn:example:PipelineSchema/lastNodeName', 'type': 'string' } as const;

const pipelineValidators = {
  tokenBudget:  Validator.compile<PipelineSchema['tokenBudget']>(PipelineTokenBudgetSchema),
  messages:     Validator.compile<PipelineSchema['messages']>(PipelineMessagesSchema),
  lastNodeName: Validator.compile<PipelineSchema['lastNodeName']>(PipelineLastNodeNameSchema),
};

export class StoreDemos {
  static async typed(): Promise<void> {
    const inner = new MemoryStore();
    const typed = new TypedStore<PipelineSchema>(inner, pipelineValidators);

    await typed.set('tokenBudget', 4096);
    const budget = await typed.get('tokenBudget');   // number | null
    await typed.update('messages', (msgs) => [...(msgs ?? []), 'hello']);

    // TypeScript rejects wrong keys and wrong value types at compile time.
    // await typed.set('unknown', 'x');              // TS error: key not in schema
    // await typed.set('tokenBudget', 'not a num');  // TS error: expected number

    const raw: StoreInterface = typed.inner;
    await raw.set('someFlag', true);
    if (budget !== null) {
      await typed.set('tokenBudget', budget);
    }
  }
  // #endregion typed-store

  // ---------------------------------------------------------------------------
  // StoreInterface concurrency: lost-update vs atomic update
  // ---------------------------------------------------------------------------

  // #region store-concurrency
  static async concurrency(): Promise<void> {
    const store = new MemoryStore();

    // Race: two paths increment independently. Both read 0, both write 1. Final: 1 (lost update).
    const rawCounter = await store.get('counter');
    const current = typeof rawCounter === 'number' ? rawCounter : 0;
    await store.set('counter', current + 1);

    // Atomic: update holds the RMW as one indivisible operation. Final: 2.
    await store.update('counter', (n) => (typeof n === 'number' ? n : 0) + 1);
    await store.update('counter', (n) => (typeof n === 'number' ? n : 0) + 1);
  }
  // #endregion store-concurrency

  // ---------------------------------------------------------------------------
  // StoreError discrimination
  // ---------------------------------------------------------------------------

  // #region store-error-discrimination
  static async errorDiscrimination(store: RemoteStoreInterface): Promise<void> {
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
}

// ---------------------------------------------------------------------------
// Services node: reads from constructor-injected dependencies
// ---------------------------------------------------------------------------

// #region services-node
interface AppServices {
  logger: { info(msg: string): void; error(meta: object, msg: string): void };
  cache:  { get(key: string): Promise<unknown> };
  db:     { query(sql: string): Promise<unknown> };
}

export class DbFetchNode extends MonadicNode<NodeStateBase, 'success' | 'error'> {
  private readonly services: AppServices;
  readonly name    = 'db-fetch';
  readonly '@id'   = 'urn:noocodec:node:db-fetch';
  readonly outputs = ['success', 'error'] as const;
  override get outputSchema(): Record<'success' | 'error', SchemaObjectType> {
    return { 'success': { 'type': 'object' }, 'error': { 'type': 'object' } };
  }

  constructor(services: AppServices) {
    super();
    this.services = services;
  }

  override async execute(batch: Batch<NodeStateBase>) {
    this.services.logger.info('fetch start');
    const cached = await this.services.cache.get('key');
    if (cached !== null) {
      return RoutedBatch.create(NodeOutput.create('success').output, batch);
    }
    try {
      await this.services.db.query('SELECT 1');
      return RoutedBatch.create(NodeOutput.create('success').output, batch);
    } catch (error) {
      this.services.logger.error({ err: error }, 'fetch failed');
      return RoutedBatch.create(NodeOutput.create('error').output, batch);
    }
  }
}
// #endregion services-node
