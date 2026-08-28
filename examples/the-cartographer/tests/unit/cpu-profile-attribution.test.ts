import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CpuProfileAttribution } from '../../app/CpuProfileAttribution.ts';

function buildTraceEvents() {
  return [
    {
      name: 'Profile',
      id: '0x1',
      args: { data: { startTime: 0 } },
    },
    {
      name: 'ProfileChunk',
      id: '0x1',
      args: {
        data: {
          cpuProfile: {
            nodes: [
              { id: 1, callFrame: { functionName: 'root', url: '' } },
              { id: 2, callFrame: { functionName: 'foldRegion', url: 'file:///repo/InsightsFoldGather.ts' } },
              { id: 3, callFrame: { functionName: 'set', url: 'file:///repo/GraphStateTransferCodec.ts' } },
            ],
            samples: [1, 2, 2, 3],
          },
          timeDeltas: [100, 200, 300, 400],
        },
      },
    },
    {
      name: 'ProfileChunk',
      id: '0x1',
      args: {
        data: {
          cpuProfile: {
            nodes: [],
            samples: [3, 2],
          },
          timeDeltas: [500, 600],
        },
      },
    },
    { name: 'UnrelatedEvent', id: '0x1', args: {} },
  ];
}

describe('CpuProfileAttribution', () => {
  it('merges chunked profiles and computes self-time percentages per url-derived label', () => {
    const attribution = CpuProfileAttribution.compute(buildTraceEvents());

    // Total sampled time: 100+200+300+400+500+600 = 2100us.
    // node 1 (root, no url) -> label 'root', self time 100us.
    // node 2 (foldRegion, InsightsFoldGather.ts) -> self time 200+300+600 = 1100us.
    // node 3 (set, GraphStateTransferCodec.ts) -> self time 400+500 = 900us.
    const totalUs = 100 + 200 + 300 + 400 + 500 + 600;

    const root = attribution.find((entry) => entry.label === 'root');
    const insightsFold = attribution.find((entry) => entry.label === 'InsightsFoldGather');
    const graphStateCodec = attribution.find((entry) => entry.label === 'GraphStateTransferCodec');

    assert.ok(root !== undefined);
    assert.ok(insightsFold !== undefined);
    assert.ok(graphStateCodec !== undefined);

    assert.equal(root.selfTimeMs, 100 / 1000);
    assert.equal(insightsFold.selfTimeMs, 1100 / 1000);
    assert.equal(graphStateCodec.selfTimeMs, 900 / 1000);

    assert.ok(Math.abs(root.selfTimePct - (100 / totalUs) * 100) < 1e-9);
    assert.ok(Math.abs(insightsFold.selfTimePct - (1100 / totalUs) * 100) < 1e-9);
    assert.ok(Math.abs(graphStateCodec.selfTimePct - (900 / totalUs) * 100) < 1e-9);

    // Sorted descending by self time.
    assert.deepEqual(attribution.map((entry) => entry.label), [
      'InsightsFoldGather',
      'GraphStateTransferCodec',
      'root',
    ]);
  });

  it('returns an empty list when no Profile/ProfileChunk events are present', () => {
    assert.deepEqual(CpuProfileAttribution.compute([{ name: 'Other' }, 'not-an-object', null]), []);
  });
});
