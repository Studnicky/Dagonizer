import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { EMPTY_CONTRACT_FRAGMENT } from '../../src/contracts/OperationContractFragment.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAG } from '../../src/entities/index.js';
import type { NodeContextInterface } from '../../src/entities/node/NodeContext.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { Timeout } from '../../src/runtime/Timeout.js';

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

    class UseServicesNode implements NodeInterface<S, 'success', PaletteServices> {
      readonly name = 'use-services';
      readonly outputs = ['success'] as const;
  readonly 'contract' = EMPTY_CONTRACT_FRAGMENT;
      readonly timeout = Timeout.none();
      async execute(state: S, context: NodeContextInterface<PaletteServices>) {
        context.services.logger.entries.push(`hit:${context.services.client.url}`);
        state.out = context.services.client.url;
        return { 'errors': [], 'output': 'success' as const };
      }
    }

    const dispatcher = new Dagonizer<S, PaletteServices>({ services });
    dispatcher.registerNode(new UseServicesNode());
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
        'name':  'use-services', 'node': 'use-services', 'outputs': { 'success': 'end' },
      },
        { '@id': 'urn:noocodex:dag:svc/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
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

    class CheckUndefinedNode implements NodeInterface<S, 'success'> {
      readonly name = 'check-undefined';
      readonly outputs = ['success'] as const;
  readonly 'contract' = EMPTY_CONTRACT_FRAGMENT;
      readonly timeout = Timeout.none();
      async execute(state: S, context: NodeContextInterface) {
        state.out = context.services;
        return { 'errors': [], 'output': 'success' as const };
      }
    }

    const dispatcher = new Dagonizer<S>();
    dispatcher.registerNode(new CheckUndefinedNode());
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
        'name':  'check-undefined', 'node': 'check-undefined', 'outputs': { 'success': 'end' },
      },
        { '@id': 'urn:noocodex:dag:svc-default/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    });

    const result = await dispatcher.execute('svc-default', new S());
    assert.equal(result.state.out, undefined);
  });
});
