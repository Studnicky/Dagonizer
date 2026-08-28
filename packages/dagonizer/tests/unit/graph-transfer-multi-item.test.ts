/**
 * Multi-item graph-state transfer: every transport mode is combined-per-batch.
 * A batch of N distinct-runIri items round-trips through ONE combined payload
 * (one encode/hash or one store write) and splits back so each item's
 * `${runIri}#state` subgraph restores independently. Integrity is one hash per
 * batch, verified once on receipt.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { QuadType } from '../../src/contracts/TripleStoreInterface.js';
import { DagGraphTerms } from '../../src/graph/DagGraphTerms.js';
import { GraphStateTerms } from '../../src/graph/GraphStateTerms.js';
import { GraphStateTransferCodec } from '../../src/graph/GraphStateTransferCodec.js';
import { InMemoryGraphStateTransferStore } from '../../src/index.js';

const parentRun = 'urn:dagonizer:run:multi';

// Three items with DISTINCT clone run IRIs (mirrors ScatterDispatch's
// `${parent}/clone/${uuid}`), each with a distinct single quad in its state graph.
const items = [0, 1, 2].map((n) => {
  const runIri = `${parentRun}/clone/item-${n}`;
  const graph = DagGraphTerms.namedNode(GraphStateTerms.runGraphIri(runIri));
  const quad: QuadType = {
    'subject': DagGraphTerms.namedNode(`${runIri}#s`),
    'predicate': DagGraphTerms.namedNode('urn:multi:value'),
    'object': DagGraphTerms.literal(`value-${n}`),
    graph,
  };
  return { 'id': `item-${n}`, runIri, quad };
});

const identity = { 'dagIri': 'urn:multi#dag', 'placementPath': ['urn:multi/placement'], 'placementIri': 'urn:multi/placement' };

const toAsync = async function* (quads: readonly QuadType[]): AsyncIterable<QuadType> {
  for (const quad of quads) yield quad;
};

const graphItems = () => items.map((item) => ({ 'runIri': item.runIri, 'quads': toAsync([item.quad]) }));
const restoreItems = items.map((item) => ({ 'id': item.id, 'runIri': item.runIri }));

async function collect(parts: { id: string; runIri: string; quads: AsyncIterable<QuadType> }[]): Promise<Map<string, QuadType[]>> {
  const byId = new Map<string, QuadType[]>();
  for (const part of parts) {
    const quads: QuadType[] = [];
    for await (const quad of part.quads) quads.push(quad);
    byId.set(part.id, quads);
  }
  return byId;
}

function assertEachSubgraphRestores(byId: Map<string, QuadType[]>): void {
  assert.equal(byId.size, items.length);
  for (const item of items) {
    assert.deepEqual(byId.get(item.id), [item.quad], `item ${item.id} subgraph must round-trip`);
  }
}

void describe('multi-item graph-state transfer — every mode combined-per-batch', () => {
  void it('inline-nquads: one encode/hash over N graphs, split restores each', async () => {
    const transfer = await GraphStateTransferCodec.inline(graphItems());
    assert.equal(transfer.transport, 'inline-nquads');
    assert.equal(transfer.graphIris.length, items.length);
    assert.equal(transfer.quadCount, items.length);
    // The union is ONE payload spanning every distinct named graph.
    for (const item of items) assert.ok(transfer.nquads.includes(GraphStateTerms.runGraphIri(item.runIri)));

    const parts = await GraphStateTransferCodec.restore(transfer, restoreItems, null);
    assertEachSubgraphRestores(await collect(parts));
  });

  void it('inline-nquads: a tampered combined payload fails the single batch hash', async () => {
    const transfer = await GraphStateTransferCodec.inline(graphItems());
    const tampered = { ...transfer, 'nquads': `${transfer.nquads}<urn:x> <urn:y> <urn:z> <urn:g> .\n` };
    await assert.rejects(() => GraphStateTransferCodec.restore(tampered, restoreItems, null), /integrity hash mismatch/);
  });

  void it('graph-ref: ONE store write for the batch, read-once split restores each', async () => {
    const store = new InMemoryGraphStateTransferStore('urn:transfer:multi-ref');
    const transfer = await GraphStateTransferCodec.reference(store, graphItems(), identity);
    assert.equal(transfer.transport, 'graph-ref');
    assert.equal(transfer.graphIris.length, items.length);

    const parts = await GraphStateTransferCodec.restore(transfer, restoreItems, store);
    assertEachSubgraphRestores(await collect(parts));
  });

  void it('shared-endpoint: ONE lease + combined write, read-once split restores each', async () => {
    const store = new InMemoryGraphStateTransferStore('urn:transfer:multi-shared');
    const transfer = await GraphStateTransferCodec.shared(store, graphItems(), 10_000);
    assert.equal(transfer.transport, 'shared-endpoint');
    assert.equal(transfer.graphIris.length, items.length);

    const parts = await GraphStateTransferCodec.restore(transfer, restoreItems, store);
    assertEachSubgraphRestores(await collect(parts));
  });

  void it('inline-delta-nquads: combined batch delta, split applies each additions subgraph', async () => {
    const transfer = GraphStateTransferCodec.delta(
      items.map((item) => ({ 'runIri': item.runIri, 'additions': [item.quad], 'deletions': [] })),
      'urn:multi:base',
    );
    assert.equal(transfer.transport, 'inline-delta-nquads');
    assert.equal(transfer.quadCount, items.length);

    const parts = await GraphStateTransferCodec.restore(transfer, restoreItems, null);
    assertEachSubgraphRestores(await collect(parts));
  });

  void it('delta-ref: combined batch delta reference, split applies each additions subgraph', async () => {
    const transfer = GraphStateTransferCodec.delta(
      items.map((item) => ({ 'runIri': item.runIri, 'additions': [item.quad], 'deletions': [] })),
      'urn:multi:base',
      { 'reference': true },
    );
    assert.equal(transfer.transport, 'delta-ref');

    const parts = await GraphStateTransferCodec.restore(transfer, restoreItems, null);
    assertEachSubgraphRestores(await collect(parts));
  });
});
