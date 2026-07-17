import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DagContainerOptionsType, PoolEntryType } from '@studnicky/dagonizer/container';

import { NodeContainerBase } from '../../src/NodeContainerBase.js';
import type { NodeContainerBaseOptionsType } from '../../src/NodeContainerBase.js';

class NodeContainerBaseProbe extends NodeContainerBase<never> {
  static resolve(options: NodeContainerBaseOptionsType): DagContainerOptionsType {
    return NodeContainerBase.resolveOptions(options);
  }

  protected override composeEntry(): PoolEntryType<never> {
    throw new Error('not used');
  }

  protected override attachDeathListeners(): void {
    throw new Error('not used');
  }

  protected override terminateWorker(): void {
    throw new Error('not used');
  }

  protected override awaitWorkerExit(): Promise<void> {
    throw new Error('not used');
  }
}

void describe('NodeContainerBase graph-state transfer contract', () => {
  void it('forwards explicit graphStateTransferFormats into container init', () => {
    const options = NodeContainerBaseProbe.resolve({
      'registryModule': 'file:///registry.js',
      'registryVersion': '1.0.0',
      'graphStateTransferFormats': ['application/n-quads'],
    });

    assert.deepEqual(options.graphStateTransferFormats, ['application/n-quads']);
    assert.deepEqual(options.init.graphStateTransferFormats, ['application/n-quads']);
  });
});
