import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ChannelDispatch, type InitMessageShapeType } from '../../src/container/ChannelDispatch.js';
import type { BridgeMessageType } from '../../src/entities/executor/BridgeMessage.js';
import { LoopbackChannel } from '../../testing/LoopbackChannel.js';

void describe('channel dispatch negotiation', () => {
  void it('preserves host-advertised graph-state formats in ready', async () => {
    const [parentSide, hostSide] = LoopbackChannel.pair();
    const dispatch = new ChannelDispatch(parentSide);

    const init: InitMessageShapeType = {
      'registryModule': 'test-registry',
      'registryVersion': '1.0.0',
      'servicesConfig': {},
    };

    const ready = dispatch.init(init);
    hostSide.send(JSON.parse(JSON.stringify({
      'variant': 'ready',
      'registryVersion': '1.0.0',
      'capabilities': [],
      'graphStateTransferFormats': [
        'application/ld+json',
        'application/n-quads',
      ],
    })));

    await ready;

    assert.deepEqual(dispatch.graphStateTransferFormats, ['application/ld+json', 'application/n-quads']);
  });

  void it('forwards raw graph-state formats supplied in init', async () => {
    const [parentSide, hostSide] = LoopbackChannel.pair();
    const dispatch = new ChannelDispatch(parentSide);

    // Bypassing static typing to validate raw-contract forwarding behavior.
    const init = JSON.parse(JSON.stringify({
      'registryModule': 'test-registry',
      'registryVersion': '1.0.0',
      'servicesConfig': {},
      'graphStateTransferFormats': ['application/ld+json', 'application/n-quads'],
    })) as InitMessageShapeType;

    const message = new Promise<BridgeMessageType & { variant: 'init'; graphStateTransferFormats?: readonly string[] }>((resolve) => {
      hostSide.onMessage((msg) => {
        if (msg.variant === 'init') {
          resolve(msg);
        }
      });
    });

    const initPromise = dispatch.init(init);

    const initMessage = await message;

    hostSide.send({
      'variant': 'ready',
      'registryVersion': init['registryVersion'],
      'capabilities': [],
    });

    await initPromise;

    assert.deepEqual(initMessage.graphStateTransferFormats, ['application/ld+json', 'application/n-quads']);
  });
});
