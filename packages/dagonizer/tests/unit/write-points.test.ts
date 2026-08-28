import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/index.js';
import type { GraphScopeType } from '../../src/contracts/GraphDatasetProviderInterface.js';
import type { WritePointType } from '../../src/contracts/WritePoint.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { Batch } from '../../src/entities/batch/Batch.js';
import { SCATTER_PROGRESS_KEY } from '../../src/entities/constants/ProgressKey.js';
import type { GatherConfigType } from '../../src/entities/dag/GatherConfig.js';
import type { GatherNodeType } from '../../src/entities/dag/GatherNode.js';
import type { JsonValueType } from '../../src/entities/json.js';
import { DagGraphTerms } from '../../src/graph/DagGraphTerms.js';
import { GraphStateTerms } from '../../src/graph/GraphStateTerms.js';
import { InMemoryTopologyStore } from '../../src/graph/InMemoryTopologyStore.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { DAGErrorPredicate } from '../_support/DAGErrorPredicate.js';
import { MemoryFoldJournalStore } from '../_support/MemoryFoldJournalStore.js';
import { TestBatchNode } from '../_support/TestBatchNode.js';
import { TestNode } from '../_support/TestNode.js';

const DAG_IRI = 'urn:noocodec:dag:write-points';
const START_NODE_IRI = 'urn:noocodec:node:write-points:start';
const START_PLACEMENT_IRI = `${DAG_IRI}/node/start`;
const SCATTER_PLACEMENT_IRI = `${DAG_IRI}/node/scatter`;
const GATHER_PLACEMENT_IRI = `${DAG_IRI}/node/gather`;
const END_PLACEMENT_IRI = `${DAG_IRI}/node/end`;
const BODY_DAG_IRI = 'urn:noocodec:dag:write-points:body';
const BODY_NODE_IRI = 'urn:noocodec:node:write-points:body';
const BODY_PLACEMENT_IRI = `${BODY_DAG_IRI}/node/body`;
const BODY_END_PLACEMENT_IRI = `${BODY_DAG_IRI}/node/end`;
const FANOUT_NODE_IRI = 'urn:noocodec:node:write-points:fanout';
const BATCH_STEP_NODE_IRI = 'urn:noocodec:node:write-points:batch-step';
const BATCH_DAG_IRI = 'urn:noocodec:dag:write-points:batch';
const BATCH_START_PLACEMENT_IRI = `${BATCH_DAG_IRI}/node/start`;
const BATCH_STEP_PLACEMENT_IRI = `${BATCH_DAG_IRI}/node/step`;
const BATCH_END_PLACEMENT_IRI = `${BATCH_DAG_IRI}/node/end`;

class BatchWritePointState extends NodeStateBase {
  items: number[];
  snapshotGraphCalls: number;
  value: number;

  constructor(...args: ConstructorParameters<typeof NodeStateBase>) {
    super(...args);
    this.items = [];
    this.snapshotGraphCalls = 0;
    this.value = 0;
  }

  override async *snapshotGraph(runIri: string = this.runIri) {
    this.snapshotGraphCalls++;
    yield* super.snapshotGraph(runIri);
  }

  override clone(childScope: GraphScopeType): this {
    const copy = super.clone(childScope);
    copy.items = [...this.items];
    copy.value = this.value;
    return copy;
  }
}

class ScatterWritePointState extends NodeStateBase {
  items: Array<{ group: string }>;
  processed: unknown[];

  constructor(...args: ConstructorParameters<typeof NodeStateBase>) {
    super(...args);
    this.items = [{ 'group': 'same' }, { 'group': 'same' }];
    this.processed = [];
  }

  override clone(childScope: GraphScopeType): this {
    const copy = super.clone(childScope);
    copy.items = this.items.map((item) => ({ ...item }));
    copy.processed = [...this.processed];
    return copy;
  }
}

async function countScatterProgressAccess(writePoints: readonly WritePointType[]): Promise<{ reads: number; writes: number }> {
  const dispatcher = new Dagonizer<ScatterWritePointState>();
  const bodyNode = TestNode.make<ScatterWritePointState>(BODY_NODE_IRI, ['success']);
  dispatcher.registerNode(bodyNode);
  dispatcher.registerDAG(new DAGBuilder(DAG_IRI, '1.0', {
    'configuration': { 'durability': { 'writePoints': ['NodeEdges', 'WatermarkCommit'] } },
  })
    .scatter(SCATTER_PLACEMENT_IRI, 'items', bodyNode, {
      'all-success': GATHER_PLACEMENT_IRI,
      'partial': GATHER_PLACEMENT_IRI,
      'all-error': GATHER_PLACEMENT_IRI,
      'empty': END_PLACEMENT_IRI,
    }, {
      'configuration': { 'execution': { 'batching': {
        'mode': 'reservoir',
        'concurrency': 1,
        'reservoir': { 'keyField': 'group', 'capacity': 2 },
      } }, 'durability': { 'writePoints': [...writePoints] } },
    })
    .gather(GATHER_PLACEMENT_IRI, {
      [SCATTER_PLACEMENT_IRI]: {},
    }, { 'strategy': 'append', 'target': 'processed' }, {
      'success': END_PLACEMENT_IRI,
      'error': END_PLACEMENT_IRI,
      'empty': END_PLACEMENT_IRI,
    })
    .terminal(END_PLACEMENT_IRI)
    .build());

  const state = new ScatterWritePointState();
  const getMetadata = state.getMetadata.bind(state);
  const setMetadata = state.setMetadata.bind(state);
  let reads = 0;
  let writes = 0;
  state.getMetadata = (key: string): JsonValueType | undefined => {
    if (key === SCATTER_PROGRESS_KEY) reads++;
    return getMetadata(key);
  };
  state.setMetadata = (key: string, value: unknown): void => {
    setMetadata(key, value);
    if (key === SCATTER_PROGRESS_KEY) writes++;
  };

  const result = await dispatcher.execute(DAG_IRI, state);
  assert.equal(result.terminalOutcome, 'completed');
  return { reads, writes };
}

function registerFoldJournalBinding(
  dagIri: string,
  sources: GatherNodeType['sources'],
  gather: GatherConfigType,
  includeSecondScatter: boolean,
): Dagonizer<ScatterWritePointState> {
  const scatterIri = `${dagIri}/node/scatter`;
  const secondScatterIri = `${dagIri}/node/scatter-second`;
  const gatherIri = `${dagIri}/node/gather`;
  const endIri = `${dagIri}/node/end`;
  const bodyNode = TestNode.make<ScatterWritePointState>(`${dagIri}:body`, ['success']);
  const dispatcher = new Dagonizer<ScatterWritePointState>({
    'foldJournalStores': { 'journal': new MemoryFoldJournalStore() },
  });
  dispatcher.registerNode(bodyNode);

  const builder = new DAGBuilder(dagIri, '1.0', {
    'configuration': { 'durability': {
      'writePoints': ['WatermarkCommit', 'FoldDeltaJournal'],
      'foldJournalStoreKey': 'journal',
    } },
  }).scatter(scatterIri, 'items', bodyNode, {
    'all-success': gatherIri,
    'partial': gatherIri,
    'all-error': gatherIri,
    'empty': endIri,
  });

  if (includeSecondScatter) {
    builder.scatter(secondScatterIri, 'items', bodyNode, {
      'all-success': gatherIri,
      'partial': gatherIri,
      'all-error': gatherIri,
      'empty': endIri,
    });
    builder.entrypoints({ 'main': scatterIri, 'second': secondScatterIri });
  }

  dispatcher.registerDAG(builder
    .gather(gatherIri, sources, gather, {
      'success': endIri,
      'error': endIri,
      'empty': endIri,
    })
    .terminal(endIri)
    .build());
  return dispatcher;
}

void describe('write-point policy', () => {
  void it('DAGBuilder emits DAG-level and scatter-level writePoints', () => {
    const startNode = TestNode.make(START_NODE_IRI, ['success']);
    const dag = new DAGBuilder(DAG_IRI, '1.0', {
      'configuration': { 'durability': { 'writePoints': ['NodeEdges', 'WatermarkCommit'] } },
    })
      .node(START_PLACEMENT_IRI, startNode, { 'success': SCATTER_PLACEMENT_IRI })
      .scatter(SCATTER_PLACEMENT_IRI, 'items', { 'dag': BODY_DAG_IRI }, {
        'all-success': END_PLACEMENT_IRI,
        'partial': END_PLACEMENT_IRI,
        'all-error': END_PLACEMENT_IRI,
        'empty': END_PLACEMENT_IRI,
      }, {
        'configuration': { 'durability': { 'writePoints': [] } },
      })
      .terminal(END_PLACEMENT_IRI)
      .build();

    assert.deepEqual(dag.configuration?.durability?.writePoints, ['NodeEdges', 'WatermarkCommit']);
    const scatter = dag.nodes.find((node) => node['@id'] === SCATTER_PLACEMENT_IRI);
    assert.ok(scatter !== undefined && scatter['@type'] === 'ScatterNode');
    if (scatter['@type'] === 'ScatterNode') {
      assert.deepEqual(scatter.configuration?.durability?.writePoints, []);
    }
  });

  void it('registerDAG resolves defaults and scatter overrides without merging', () => {
    const dispatcher = new Dagonizer();
    const startNode = TestNode.make(START_NODE_IRI, ['success']);
    const bodyNode = TestNode.make(BODY_NODE_IRI, ['success']);
    dispatcher.registerNode(startNode);
    dispatcher.registerNode(bodyNode);
    dispatcher.registerDAG(new DAGBuilder(BODY_DAG_IRI, '1.0')
      .node(BODY_PLACEMENT_IRI, bodyNode, { 'success': BODY_END_PLACEMENT_IRI })
      .terminal(BODY_END_PLACEMENT_IRI)
      .build());

    const dag = new DAGBuilder(DAG_IRI, '1.0')
      .node(START_PLACEMENT_IRI, startNode, { 'success': SCATTER_PLACEMENT_IRI })
      .scatter(SCATTER_PLACEMENT_IRI, 'items', { 'dag': BODY_DAG_IRI }, {
        'all-success': END_PLACEMENT_IRI,
        'partial': END_PLACEMENT_IRI,
        'all-error': END_PLACEMENT_IRI,
        'empty': END_PLACEMENT_IRI,
      }, {
        'configuration': { 'durability': { 'writePoints': [] } },
      })
      .terminal(END_PLACEMENT_IRI)
      .build();

    dispatcher.registerDAG(dag);

    assert.deepEqual(dispatcher.getDagWritePoints(DAG_IRI), ['NodeEdges', 'WatermarkCommit']);
    assert.deepEqual(dispatcher.getPlacementWritePoints(START_PLACEMENT_IRI), ['NodeEdges', 'WatermarkCommit']);
    assert.deepEqual(dispatcher.getPlacementWritePoints(SCATTER_PLACEMENT_IRI), []);
  });

  void it('accesses scatter checkpoints only when WatermarkCommit is selected', async () => {
    assert.deepEqual(await countScatterProgressAccess([]), { 'reads': 0, 'writes': 0 });
    const persisted = await countScatterProgressAccess(['WatermarkCommit']);
    assert.ok(persisted.reads > 0);
    assert.equal(persisted.writes, 1);
  });

  void it('rejects FoldDeltaJournal without WatermarkCommit at the DAG level', () => {
    const dispatcher = new Dagonizer();
    const startNode = TestNode.make('urn:noocodec:node:write-points:invalid-dag', ['success']);
    dispatcher.registerNode(startNode);
    const dag = new DAGBuilder('urn:noocodec:dag:write-points:invalid-dag', '1.0', {
      'configuration': { 'durability': { 'writePoints': ['FoldDeltaJournal'] } },
    })
      .node('urn:noocodec:dag:write-points:invalid-dag/node/start', startNode, {
        'success': 'urn:noocodec:dag:write-points:invalid-dag/node/end',
      })
      .terminal('urn:noocodec:dag:write-points:invalid-dag/node/end')
      .build();

    assert.throws(
      () => dispatcher.registerDAG(dag),
      /writePoints cannot include 'FoldDeltaJournal' without 'WatermarkCommit'/u,
    );
  });

  void it('rejects FoldDeltaJournal without WatermarkCommit in a scatter override', () => {
    const dispatcher = new Dagonizer();
    const bodyNode = TestNode.make('urn:noocodec:node:write-points:invalid-scatter-body', ['success']);
    dispatcher.registerNode(bodyNode);
    dispatcher.registerDAG(new DAGBuilder('urn:noocodec:dag:write-points:invalid-scatter-body', '1.0')
      .node('urn:noocodec:dag:write-points:invalid-scatter-body/node/body', bodyNode, {
        'success': 'urn:noocodec:dag:write-points:invalid-scatter-body/node/end',
      })
      .terminal('urn:noocodec:dag:write-points:invalid-scatter-body/node/end')
      .build());

    const dag = new DAGBuilder('urn:noocodec:dag:write-points:invalid-scatter', '1.0', {
      'configuration': { 'durability': { 'writePoints': ['NodeEdges', 'WatermarkCommit'] } },
    })
      .scatter('urn:noocodec:dag:write-points:invalid-scatter/node/scatter', 'items', {
        'dag': 'urn:noocodec:dag:write-points:invalid-scatter-body',
      }, {
        'all-success': 'urn:noocodec:dag:write-points:invalid-scatter/node/end',
        'partial': 'urn:noocodec:dag:write-points:invalid-scatter/node/end',
        'all-error': 'urn:noocodec:dag:write-points:invalid-scatter/node/end',
        'empty': 'urn:noocodec:dag:write-points:invalid-scatter/node/end',
      }, {
        'configuration': { 'durability': { 'writePoints': ['FoldDeltaJournal'] } },
      })
      .terminal('urn:noocodec:dag:write-points:invalid-scatter/node/end')
      .build();

    assert.throws(
      () => dispatcher.registerDAG(dag),
      /writePoints cannot include 'FoldDeltaJournal' without 'WatermarkCommit'/u,
    );
  });

  void it('rejects FoldDeltaJournal on a scatter when no fold journal store is configured', () => {
    const dispatcher = new Dagonizer();
    const bodyNode = TestNode.make('urn:noocodec:node:write-points:no-store-body', ['success']);
    dispatcher.registerNode(bodyNode);
    dispatcher.registerDAG(new DAGBuilder('urn:noocodec:dag:write-points:no-store-body', '1.0')
      .node('urn:noocodec:dag:write-points:no-store-body/node/body', bodyNode, {
        'success': 'urn:noocodec:dag:write-points:no-store-body/node/end',
      })
      .terminal('urn:noocodec:dag:write-points:no-store-body/node/end')
      .build());

    const dag = new DAGBuilder('urn:noocodec:dag:write-points:no-store', '1.0', {
      'configuration': { 'durability': {
        'writePoints': ['NodeEdges', 'WatermarkCommit', 'FoldDeltaJournal'],
        'foldJournalStoreKey': 'journal',
      } },
    })
      .scatter('urn:noocodec:dag:write-points:no-store/node/scatter', 'items', {
        'dag': 'urn:noocodec:dag:write-points:no-store-body',
      }, {
        'all-success': 'urn:noocodec:dag:write-points:no-store/node/join',
        'partial': 'urn:noocodec:dag:write-points:no-store/node/join',
        'all-error': 'urn:noocodec:dag:write-points:no-store/node/join',
        'empty': 'urn:noocodec:dag:write-points:no-store/node/end',
      })
      .gather('urn:noocodec:dag:write-points:no-store/node/join', {
        ['urn:noocodec:dag:write-points:no-store/node/scatter']: {},
      }, { 'strategy': 'append', 'target': 'processed' }, {
        'success': 'urn:noocodec:dag:write-points:no-store/node/end',
        'error': 'urn:noocodec:dag:write-points:no-store/node/end',
        'empty': 'urn:noocodec:dag:write-points:no-store/node/end',
      })
      .terminal('urn:noocodec:dag:write-points:no-store/node/end')
      .build();

    assert.throws(
      () => dispatcher.registerDAG(dag),
      /requires a bound durability\.foldJournalStoreKey/u,
    );
  });

  void it('rejects FoldDeltaJournal when its gather declares zero sources', () => {
    assert.throws(
      () => registerFoldJournalBinding(
        'urn:noocodec:dag:write-points:zero-gather-source',
        {},
        { 'strategy': 'append', 'target': 'processed' },
        false,
      ),
      DAGErrorPredicate.isValidationError,
    );
  });

  void it('rejects FoldDeltaJournal on a scatter with no non-empty outcome', () => {
    const dagIri = 'urn:noocodec:dag:write-points:no-non-empty-outcome';
    const bodyDagIri = `${dagIri}:body`;
    const scatterIri = `${dagIri}/node/scatter`;
    const endIri = `${dagIri}/node/end`;
    const bodyNode = TestNode.make(`${bodyDagIri}:node`, ['success']);
    const dispatcher = new Dagonizer({
      'foldJournalStores': { 'journal': new MemoryFoldJournalStore() },
    });
    dispatcher.registerNode(bodyNode);

    const dag = new DAGBuilder(dagIri, '1.0', {
      'configuration': { 'durability': {
        'writePoints': ['WatermarkCommit', 'FoldDeltaJournal'],
        'foldJournalStoreKey': 'journal',
      } },
    })
      .scatter(scatterIri, 'items', bodyNode, {
        'empty': endIri,
      })
      .terminal(endIri)
      .build();

    assert.throws(
      () => dispatcher.registerDAG(dag),
      /selects 'FoldDeltaJournal' but declares no non-empty outcome routed to a GatherNode/u,
    );
  });

  void it('rejects FoldDeltaJournal when its gather declares multiple sources', () => {
    const dagIri = 'urn:noocodec:dag:write-points:multiple-gather-sources';
    assert.throws(
      () => registerFoldJournalBinding(
        dagIri,
        {
          [`${dagIri}/node/scatter`]: {},
          [`${dagIri}/node/scatter-second`]: {},
        },
        { 'strategy': 'append', 'target': 'processed' },
        true,
      ),
      /must declare exactly one source for 'FoldDeltaJournal'/u,
    );
  });

  void it('rejects FoldDeltaJournal when its gather declares the wrong source', () => {
    const dagIri = 'urn:noocodec:dag:write-points:wrong-gather-source';
    assert.throws(
      () => registerFoldJournalBinding(
        dagIri,
        { [`${dagIri}/node/scatter-second`]: {} },
        { 'strategy': 'append', 'target': 'processed' },
        true,
      ),
      /must declare ScatterNode .* as its source for 'FoldDeltaJournal'/u,
    );
  });

  void it('registers FoldDeltaJournal with append, collect, map, and partition gathers', () => {
    const appendDagIri = 'urn:noocodec:dag:write-points:append-registration';
    const collectDagIri = 'urn:noocodec:dag:write-points:collect-registration';
    const mapDagIri = 'urn:noocodec:dag:write-points:map-registration';
    const partitionDagIri = 'urn:noocodec:dag:write-points:partition-registration';

    const appendDispatcher = registerFoldJournalBinding(
      appendDagIri,
      { [`${appendDagIri}/node/scatter`]: {} },
      { 'strategy': 'append', 'target': 'processed' },
      false,
    );
    const collectDispatcher = registerFoldJournalBinding(
      collectDagIri,
      { [`${collectDagIri}/node/scatter`]: {} },
      { 'strategy': 'collect', 'target': 'processed' },
      false,
    );
    const mapDispatcher = registerFoldJournalBinding(
      mapDagIri,
      { [`${mapDagIri}/node/scatter`]: {} },
      { 'strategy': 'map', 'mapping': { 'produced': 'processed' } },
      false,
    );
    const partitionDispatcher = registerFoldJournalBinding(
      partitionDagIri,
      { [`${partitionDagIri}/node/scatter`]: {} },
      { 'strategy': 'partition', 'partitions': { 'success': 'processed' } },
      false,
    );

    assert.deepEqual(appendDispatcher.getPlacementWritePoints(`${appendDagIri}/node/scatter`), ['WatermarkCommit', 'FoldDeltaJournal']);
    assert.deepEqual(collectDispatcher.getPlacementWritePoints(`${collectDagIri}/node/scatter`), ['WatermarkCommit', 'FoldDeltaJournal']);
    assert.deepEqual(mapDispatcher.getPlacementWritePoints(`${mapDagIri}/node/scatter`), ['WatermarkCommit', 'FoldDeltaJournal']);
    assert.deepEqual(partitionDispatcher.getPlacementWritePoints(`${partitionDagIri}/node/scatter`), ['WatermarkCommit', 'FoldDeltaJournal']);
  });

  void it('rejects FoldDeltaJournal when the routed gather strategy cannot be replayed from contribution deltas', () => {
    const dispatcher = new Dagonizer({ 'foldJournalStores': { 'journal': new MemoryFoldJournalStore() } });
    const bodyNode = TestNode.make('urn:noocodec:node:write-points:unsupported-gather-body', ['success']);
    dispatcher.registerNode(bodyNode);
    dispatcher.registerDAG(new DAGBuilder('urn:noocodec:dag:write-points:unsupported-gather-body', '1.0')
      .node('urn:noocodec:dag:write-points:unsupported-gather-body/node/body', bodyNode, {
        'success': 'urn:noocodec:dag:write-points:unsupported-gather-body/node/end',
      })
      .terminal('urn:noocodec:dag:write-points:unsupported-gather-body/node/end')
      .build());

    const dag = new DAGBuilder('urn:noocodec:dag:write-points:unsupported-gather', '1.0', {
      'configuration': { 'durability': {
        'writePoints': ['NodeEdges', 'WatermarkCommit', 'FoldDeltaJournal'],
        'foldJournalStoreKey': 'journal',
      } },
    })
      .scatter('urn:noocodec:dag:write-points:unsupported-gather/node/scatter', 'items', {
        'dag': 'urn:noocodec:dag:write-points:unsupported-gather-body',
      }, {
        'all-success': 'urn:noocodec:dag:write-points:unsupported-gather/node/join',
        'partial': 'urn:noocodec:dag:write-points:unsupported-gather/node/join',
        'all-error': 'urn:noocodec:dag:write-points:unsupported-gather/node/join',
        'empty': 'urn:noocodec:dag:write-points:unsupported-gather/node/end',
      })
      .gather('urn:noocodec:dag:write-points:unsupported-gather/node/join', {
        ['urn:noocodec:dag:write-points:unsupported-gather/node/scatter']: {},
      }, { 'strategy': 'discard' }, {
        'success': 'urn:noocodec:dag:write-points:unsupported-gather/node/end',
        'error': 'urn:noocodec:dag:write-points:unsupported-gather/node/end',
        'empty': 'urn:noocodec:dag:write-points:unsupported-gather/node/end',
      })
      .terminal('urn:noocodec:dag:write-points:unsupported-gather/node/end')
      .build();

    assert.throws(
      () => dispatcher.registerDAG(dag),
      /cannot be replayed from contribution deltas/u,
    );
  });

  void it('accepts FoldDeltaJournal on a scatter routed to a replayable gather strategy with a configured store', () => {
    const dispatcher = new Dagonizer({ 'foldJournalStores': { 'journal': new MemoryFoldJournalStore() } });
    const bodyNode = TestNode.make('urn:noocodec:node:write-points:replayable-gather-body', ['success']);
    dispatcher.registerNode(bodyNode);
    dispatcher.registerDAG(new DAGBuilder('urn:noocodec:dag:write-points:replayable-gather-body', '1.0')
      .node('urn:noocodec:dag:write-points:replayable-gather-body/node/body', bodyNode, {
        'success': 'urn:noocodec:dag:write-points:replayable-gather-body/node/end',
      })
      .terminal('urn:noocodec:dag:write-points:replayable-gather-body/node/end')
      .build());

    const dag = new DAGBuilder('urn:noocodec:dag:write-points:replayable-gather', '1.0', {
      'configuration': { 'durability': {
        'writePoints': ['NodeEdges', 'WatermarkCommit', 'FoldDeltaJournal'],
        'foldJournalStoreKey': 'journal',
      } },
    })
      .scatter('urn:noocodec:dag:write-points:replayable-gather/node/scatter', 'items', {
        'dag': 'urn:noocodec:dag:write-points:replayable-gather-body',
      }, {
        'all-success': 'urn:noocodec:dag:write-points:replayable-gather/node/join',
        'partial': 'urn:noocodec:dag:write-points:replayable-gather/node/join',
        'all-error': 'urn:noocodec:dag:write-points:replayable-gather/node/join',
        'empty': 'urn:noocodec:dag:write-points:replayable-gather/node/end',
      })
      .gather('urn:noocodec:dag:write-points:replayable-gather/node/join', {
        ['urn:noocodec:dag:write-points:replayable-gather/node/scatter']: {},
      }, { 'strategy': 'append', 'target': 'processed' }, {
        'success': 'urn:noocodec:dag:write-points:replayable-gather/node/end',
        'error': 'urn:noocodec:dag:write-points:replayable-gather/node/end',
        'empty': 'urn:noocodec:dag:write-points:replayable-gather/node/end',
      })
      .terminal('urn:noocodec:dag:write-points:replayable-gather/node/end')
      .build();

    assert.doesNotThrow(() => dispatcher.registerDAG(dag));
  });

  void it('rejects FoldDeltaJournal when a non-empty outcome routes directly to a TerminalNode', () => {
    const dispatcher = new Dagonizer({ 'foldJournalStores': { 'journal': new MemoryFoldJournalStore() } });
    const bodyNode = TestNode.make('urn:noocodec:node:write-points:terminal-outcome-body', ['success']);
    dispatcher.registerNode(bodyNode);
    dispatcher.registerDAG(new DAGBuilder('urn:noocodec:dag:write-points:terminal-outcome-body', '1.0')
      .node('urn:noocodec:dag:write-points:terminal-outcome-body/node/body', bodyNode, {
        'success': 'urn:noocodec:dag:write-points:terminal-outcome-body/node/end',
      })
      .terminal('urn:noocodec:dag:write-points:terminal-outcome-body/node/end')
      .build());

    const dag = new DAGBuilder('urn:noocodec:dag:write-points:terminal-outcome', '1.0', {
      'configuration': { 'durability': {
        'writePoints': ['NodeEdges', 'WatermarkCommit', 'FoldDeltaJournal'],
        'foldJournalStoreKey': 'journal',
      } },
    })
      .scatter('urn:noocodec:dag:write-points:terminal-outcome/node/scatter', 'items', {
        'dag': 'urn:noocodec:dag:write-points:terminal-outcome-body',
      }, {
        'all-success': 'urn:noocodec:dag:write-points:terminal-outcome/node/end',
        'partial': 'urn:noocodec:dag:write-points:terminal-outcome/node/end',
        'all-error': 'urn:noocodec:dag:write-points:terminal-outcome/node/end',
        'empty': 'urn:noocodec:dag:write-points:terminal-outcome/node/end',
      })
      .terminal('urn:noocodec:dag:write-points:terminal-outcome/node/end')
      .build();

    assert.throws(
      () => dispatcher.registerDAG(dag),
      /must resolve to a single first-class GatherNode/u,
    );
  });

  void it('rejects FoldDeltaJournal when non-empty outcomes route to two different GatherNodes', () => {
    const dispatcher = new Dagonizer({ 'foldJournalStores': { 'journal': new MemoryFoldJournalStore() } });
    const bodyNode = TestNode.make('urn:noocodec:node:write-points:multi-gather-body', ['success']);
    dispatcher.registerNode(bodyNode);
    dispatcher.registerDAG(new DAGBuilder('urn:noocodec:dag:write-points:multi-gather-body', '1.0')
      .node('urn:noocodec:dag:write-points:multi-gather-body/node/body', bodyNode, {
        'success': 'urn:noocodec:dag:write-points:multi-gather-body/node/end',
      })
      .terminal('urn:noocodec:dag:write-points:multi-gather-body/node/end')
      .build());

    const dag = new DAGBuilder('urn:noocodec:dag:write-points:multi-gather', '1.0', {
      'configuration': { 'durability': {
        'writePoints': ['NodeEdges', 'WatermarkCommit', 'FoldDeltaJournal'],
        'foldJournalStoreKey': 'journal',
      } },
    })
      .scatter('urn:noocodec:dag:write-points:multi-gather/node/scatter', 'items', {
        'dag': 'urn:noocodec:dag:write-points:multi-gather-body',
      }, {
        'all-success': 'urn:noocodec:dag:write-points:multi-gather/node/join-a',
        'partial': 'urn:noocodec:dag:write-points:multi-gather/node/join-b',
        'all-error': 'urn:noocodec:dag:write-points:multi-gather/node/join-a',
        'empty': 'urn:noocodec:dag:write-points:multi-gather/node/end',
      })
      .gather('urn:noocodec:dag:write-points:multi-gather/node/join-a', {
        ['urn:noocodec:dag:write-points:multi-gather/node/scatter']: {},
      }, { 'strategy': 'append', 'target': 'processed' }, {
        'success': 'urn:noocodec:dag:write-points:multi-gather/node/end',
        'error': 'urn:noocodec:dag:write-points:multi-gather/node/end',
        'empty': 'urn:noocodec:dag:write-points:multi-gather/node/end',
      })
      .gather('urn:noocodec:dag:write-points:multi-gather/node/join-b', {
        ['urn:noocodec:dag:write-points:multi-gather/node/scatter']: {},
      }, { 'strategy': 'append', 'target': 'processed' }, {
        'success': 'urn:noocodec:dag:write-points:multi-gather/node/end',
        'error': 'urn:noocodec:dag:write-points:multi-gather/node/end',
        'empty': 'urn:noocodec:dag:write-points:multi-gather/node/end',
      })
      .terminal('urn:noocodec:dag:write-points:multi-gather/node/end')
      .build();

    assert.throws(
      () => dispatcher.registerDAG(dag),
      /routes to multiple GatherNodes/u,
    );
  });

  void it('projects NodeEdges for every item in a shared batch placement', async () => {
    const store = new InMemoryTopologyStore();
    const dispatcher = new Dagonizer<BatchWritePointState>({ 'executionTopologyStore': store });

    const fanoutNode = TestBatchNode.of<BatchWritePointState, 'out'>(FANOUT_NODE_IRI, ['out'], (batch) => {
      const source = batch.row(0).state;
      const items = [0, 1, 2].map((index) => ({
        'id': String(index),
        'state': source.clone({
          'runIri': `${source.runIri}/clone/${index}`,
          'dagIri': BATCH_DAG_IRI,
          'placementIri': BATCH_START_PLACEMENT_IRI,
          'workItemIri': String(index),
        }),
      }));
      return new Map([['out', Batch.from(items)]]);
    });
    const batchStepNode = TestBatchNode.of<BatchWritePointState, 'success'>(BATCH_STEP_NODE_IRI, ['success'], (batch) => {
      return new Map([['success', batch]]);
    });
    dispatcher.registerNode(fanoutNode);
    dispatcher.registerNode(batchStepNode);

    dispatcher.registerDAG(new DAGBuilder(BATCH_DAG_IRI, '1.0', {
      'configuration': { 'durability': { 'writePoints': ['NodeEdges', 'WatermarkCommit'] } },
    })
      .node(BATCH_START_PLACEMENT_IRI, fanoutNode, { 'out': BATCH_STEP_PLACEMENT_IRI })
      .node(BATCH_STEP_PLACEMENT_IRI, batchStepNode, { 'success': BATCH_END_PLACEMENT_IRI })
      .terminal(BATCH_END_PLACEMENT_IRI)
      .build());

    const result = await dispatcher.execute(BATCH_DAG_IRI, new BatchWritePointState());

    assert.equal(result.terminalOutcome, 'completed');

    const executionSubjects = [...new Set(store.select({
      'subject': '?execution',
      'predicate': DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.PlacementPredicate),
      'object': DagGraphTerms.namedNode(BATCH_STEP_PLACEMENT_IRI),
    }).map((row) => row['execution']?.value).filter((value): value is string => value !== undefined))].sort();

    assert.equal(executionSubjects.length, 3);
    for (const executionIri of executionSubjects) {
      const execution = DagGraphTerms.namedNode(executionIri);
      assert.equal(store.ask({
        'subject': execution,
        'predicate': DagGraphTerms.namedNode(DagGraphTerms.RDF_TYPE),
        'object': DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.PlacementExecution),
      }), true);
      assert.equal(store.ask({
        'subject': execution,
        'predicate': DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.LifecycleEvent),
        'object': DagGraphTerms.literal('started'),
      }), true);
      assert.equal(store.ask({
        'subject': execution,
        'predicate': DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.LifecycleEvent),
        'object': DagGraphTerms.literal('completed'),
      }), true);
      assert.equal(store.ask({
        'subject': execution,
        'predicate': DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.Output),
        'object': DagGraphTerms.literal('success'),
      }), true);
    }
  });

  void it('projects full item state into the execution topology store when FullItemProjection is enabled', async () => {
    const store = new InMemoryTopologyStore();
    const dispatcher = new Dagonizer<BatchWritePointState>({ 'executionTopologyStore': store });
    const startNode = TestNode.make<BatchWritePointState>(START_NODE_IRI, ['success'], (state) => {
      state.value = 42;
      state.setMetadata('projection', 'execution-store');
      return 'success';
    });

    dispatcher.registerNode(startNode);
    dispatcher.registerDAG(new DAGBuilder(DAG_IRI, '1.0', {
      'configuration': { 'durability': { 'writePoints': ['FullItemProjection'] } },
    })
      .node(START_PLACEMENT_IRI, startNode, { 'success': END_PLACEMENT_IRI })
      .terminal(END_PLACEMENT_IRI)
      .build());

    const result = await dispatcher.execute(DAG_IRI, new BatchWritePointState());

    assert.equal(result.terminalOutcome, 'completed');
    const graph = DagGraphTerms.namedNode(GraphStateTerms.runGraphIri(result.state.runIri));
    const valueCell = DagGraphTerms.namedNode(GraphStateTerms.stateCellIri(result.state.runIri, 'domain.value'));
    const metadataCell = DagGraphTerms.namedNode(GraphStateTerms.stateCellIri(result.state.runIri, 'metadata.projection'));

    assert.equal(store.count({ graph }) > 0, true);
    assert.equal(store.ask({
      'subject': valueCell,
      'predicate': DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.StateValuePredicate),
      'object': DagGraphTerms.literal('42', GraphStateTerms.XSD.integer),
      graph,
    }), true);
    assert.equal(store.ask({
      'subject': metadataCell,
      'predicate': DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.StateValuePredicate),
      'object': DagGraphTerms.literal('execution-store'),
      graph,
    }), true);
  });

  void it('projects full item state into the in-memory snapshot store without touching the execution store', async () => {
    const store = new InMemoryTopologyStore();
    const dispatcher = new Dagonizer<BatchWritePointState>({ 'executionTopologyStore': store });
    const startNode = TestNode.make<BatchWritePointState>(START_NODE_IRI, ['success'], (state) => {
      state.value = 7;
      state.setMetadata('projection', 'ram-only');
      return 'success';
    });

    dispatcher.registerNode(startNode);
    dispatcher.registerDAG(new DAGBuilder(DAG_IRI, '1.0', {
      'configuration': { 'durability': { 'writePoints': ['InMemorySnapshot'] } },
    })
      .node(START_PLACEMENT_IRI, startNode, { 'success': END_PLACEMENT_IRI })
      .terminal(END_PLACEMENT_IRI)
      .build());

    const result = await dispatcher.execute(DAG_IRI, new BatchWritePointState());

    assert.equal(result.terminalOutcome, 'completed');
    const graph = DagGraphTerms.namedNode(GraphStateTerms.runGraphIri(result.state.runIri));
    const valueCell = DagGraphTerms.namedNode(GraphStateTerms.stateCellIri(result.state.runIri, 'domain.value'));
    const metadataCell = DagGraphTerms.namedNode(GraphStateTerms.stateCellIri(result.state.runIri, 'metadata.projection'));
    const snapshotStore = dispatcher.getInMemorySnapshotStore();

    assert.equal(store.count({ graph }), 0);
    assert.equal(snapshotStore.ask({
      'subject': valueCell,
      'predicate': DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.StateValuePredicate),
      'object': DagGraphTerms.literal('7', GraphStateTerms.XSD.integer),
      graph,
    }), true);
    assert.equal(snapshotStore.ask({
      'subject': metadataCell,
      'predicate': DagGraphTerms.namedNode(GraphStateTerms.DAGONIZER.StateValuePredicate),
      'object': DagGraphTerms.literal('ram-only'),
      graph,
    }), true);
  });

  void it('does not project failed node state through FullItemProjection', async () => {
    const store = new InMemoryTopologyStore();
    const dispatcher = new Dagonizer<BatchWritePointState>({ 'executionTopologyStore': store });
    const node = TestNode.make<BatchWritePointState>(START_NODE_IRI, ['success'], () => {
      throw new Error('projection failure fixture');
    });
    dispatcher.registerNode(node);
    dispatcher.registerDAG(new DAGBuilder(DAG_IRI, '1.0', {
      'configuration': { 'durability': { 'writePoints': ['FullItemProjection'] } },
    })
      .node(START_PLACEMENT_IRI, node, { 'success': END_PLACEMENT_IRI })
      .terminal(END_PLACEMENT_IRI)
      .build());

    const state = new BatchWritePointState();
    const result = await dispatcher.execute(DAG_IRI, state);
    const graph = DagGraphTerms.namedNode(GraphStateTerms.runGraphIri(state.runIri));

    assert.equal(result.terminalOutcome, null);
    assert.equal(state.snapshotGraphCalls, 0);
    assert.equal(store.count({ graph }), 0);
  });

  void it('does not project failed node state through InMemorySnapshot', async () => {
    const dispatcher = new Dagonizer<BatchWritePointState>();
    const node = TestNode.make<BatchWritePointState>(START_NODE_IRI, ['success'], () => {
      throw new Error('snapshot failure fixture');
    });
    dispatcher.registerNode(node);
    dispatcher.registerDAG(new DAGBuilder(DAG_IRI, '1.0', {
      'configuration': { 'durability': { 'writePoints': ['InMemorySnapshot'] } },
    })
      .node(START_PLACEMENT_IRI, node, { 'success': END_PLACEMENT_IRI })
      .terminal(END_PLACEMENT_IRI)
      .build());

    const state = new BatchWritePointState();
    const result = await dispatcher.execute(DAG_IRI, state);
    const graph = DagGraphTerms.namedNode(GraphStateTerms.runGraphIri(state.runIri));

    assert.equal(result.terminalOutcome, null);
    assert.equal(state.snapshotGraphCalls, 0);
    assert.equal(dispatcher.getInMemorySnapshotStore().count({ graph }), 0);
  });
});
