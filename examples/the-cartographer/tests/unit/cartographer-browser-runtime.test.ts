import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DAGType } from '@studnicky/dagonizer';

import { CartographerBrowserRuntime } from '../../CartographerBrowserRuntime.ts';
import { CARTOGRAPHER_IRIS } from '../../cartographerIds.ts';

class NavigatorProbeFixture {
  static setHardwareConcurrency(hardwareConcurrency: number): void {
    Object.defineProperty(globalThis, 'navigator', {
      'configurable': true,
      'value': { hardwareConcurrency },
    });
  }

  static restore(descriptor: PropertyDescriptor | undefined): void {
    if (descriptor === undefined) {
      Reflect.deleteProperty(globalThis, 'navigator');
      return;
    }
    Object.defineProperty(globalThis, 'navigator', descriptor);
  }
}

class RuntimeAssertions {
  static hasCanonicalBatching(dag: DAGType, concurrency: number): void {
    const processStreamIri = CARTOGRAPHER_IRIS.placementIri(
      CARTOGRAPHER_IRIS.dag.cartographer,
      'process-stream',
    );
    const scatter = dag.nodes.find((node) => node['@id'] === processStreamIri);
    assert.ok(scatter, 'process-stream placement must exist');
    if (scatter['@type'] !== 'ScatterNode') assert.fail('process-stream must be a ScatterNode');
    assert.deepEqual(scatter.configuration?.execution?.batching, {
      'mode': 'reservoir',
      concurrency,
      'reservoir': {
        'keyField': 'eventType',
        'capacity': 100,
        'idleMs': null,
      },
    });
  }
}

describe('CartographerBrowserRuntime', () => {
  it('derives concurrency from the system probe at every configuration access', () => {
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    try {
      NavigatorProbeFixture.setHardwareConcurrency(10);
      const tenCoreConfiguration = CartographerBrowserRuntime.configuration;
      assert.equal(tenCoreConfiguration.execution.batching.concurrency, 8);
      assert.deepEqual(tenCoreConfiguration.execution.batching.reservoir, {
        'keyField': 'eventType',
        'capacity': 100,
        'idleMs': null,
      });

      NavigatorProbeFixture.setHardwareConcurrency(1);
      assert.equal(CartographerBrowserRuntime.configuration.execution.batching.concurrency, 1);

      NavigatorProbeFixture.setHardwareConcurrency(64);
      assert.equal(CartographerBrowserRuntime.configuration.execution.batching.concurrency, 32);
    } finally {
      NavigatorProbeFixture.restore(navigatorDescriptor);
    }
  });

  it('uses canonical probed configuration for zero-argument build and bundle', () => {
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    try {
      NavigatorProbeFixture.setHardwareConcurrency(10);
      RuntimeAssertions.hasCanonicalBatching(CartographerBrowserRuntime.build(), 8);

      const bundle = CartographerBrowserRuntime.bundle();
      const cartographerDag = bundle.dags.find((dag) => dag['@id'] === CARTOGRAPHER_IRIS.dag.cartographer);
      assert.ok(cartographerDag, 'bundle must contain the cartographer DAG');
      RuntimeAssertions.hasCanonicalBatching(cartographerDag, 8);
    } finally {
      NavigatorProbeFixture.restore(navigatorDescriptor);
    }
  });
});
