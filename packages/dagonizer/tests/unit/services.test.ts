import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAG } from '../../src/entities/index.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

interface PaletteServices {
  readonly logger: { entries: string[] };
  readonly client: { url: string };
}

void describe('Dagonizer services container', () => {
  void it('passes the services bag through to NodeContextInterface.services', async () => {
    const services: PaletteServices = {
      'logger': { 'entries': [] },
      'client': { 'url': 'https://example' },
    };

    class S extends NodeStateBase {
      out = '';
    }

    const node: NodeInterface<S, 'success', PaletteServices> = {
      'name': 'use-services',
      'outputs': ['success'],
      async execute(state, context) {
        context.services.logger.entries.push(`hit:${context.services.client.url}`);
        state.out = context.services.client.url;
        return { 'output': 'success' };
      },
    };

    const dispatcher = new Dagonizer<S, PaletteServices>({ services });
    dispatcher.registerNode(node);
    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:svc',
      '@type':    'DAG',
      'name': 'svc',
      'version': '1',
      'entrypoint': 'use-services',
      'nodes': [{
        '@id':   'urn:noocodex:dag:svc/node/use-services',
        '@type': 'SingleNode',
        'name':  'use-services', 'node': 'use-services', 'outputs': { 'success': null },
      }],
    };
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('svc', new S());
    assert.equal(result.state.out, 'https://example');
    assert.deepEqual(services.logger.entries, ['hit:https://example']);
  });

  void it('defaults services to undefined when no bag is supplied', async () => {
    class S extends NodeStateBase {
      out: unknown = 'unset';
    }

    const node: NodeInterface<S, 'success'> = {
      'name': 'check-undefined',
      'outputs': ['success'],
      async execute(state, context) {
        state.out = context.services;
        return { 'output': 'success' };
      },
    };

    const dispatcher = new Dagonizer<S>();
    dispatcher.registerNode(node);
    dispatcher.registerDAG({
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:svc-default',
      '@type':    'DAG',
      'name': 'svc-default',
      'version': '1',
      'entrypoint': 'check-undefined',
      'nodes': [{
        '@id':   'urn:noocodex:dag:svc-default/node/check-undefined',
        '@type': 'SingleNode',
        'name':  'check-undefined', 'node': 'check-undefined', 'outputs': { 'success': null },
      }],
    });

    const result = await dispatcher.execute('svc-default', new S());
    assert.equal(result.state.out, undefined);
  });
});
