import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SchemaObjectType } from '../../src/contracts/NodeInterface.js';
import { ScalarNode } from '../../src/core/ScalarNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAGType } from '../../src/entities/index.js';
import type { NodeContextType } from '../../src/entities/node/NodeContext.js';
import type { NodeOutputType } from '../../src/entities/node/NodeOutput.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { TestNode } from '../_support/TestNode.js';

type PaletteServices = {
  readonly logger: { entries: string[] };
  readonly client: { url: string };
}

void describe('Dagonizer services container', () => {
  void it('passes the services record through to NodeContextType.services', async () => {
    const services: PaletteServices = {
      'logger': { 'entries': [] },
      'client': { 'url': 'https://example' },
    };

    class S extends NodeStateBase {
      out = '';
    }

    class UseServicesNode extends ScalarNode<S, 'success', PaletteServices> {
      readonly name = 'use-services';
      readonly outputs = ['success'] as const;
      override get outputSchema(): Record<'success', SchemaObjectType> {
        return { 'success': { 'type': 'object' } };
      }
      protected async executeOne(state: S, context: NodeContextType<PaletteServices>): Promise<NodeOutputType<'success'>> {
        const services = context.services;
        if (services === undefined) throw new Error('use-services node requires a services record');
        services.logger.entries.push(`hit:${services.client.url}`);
        state.out = services.client.url;
        return { 'errors': [], 'output': 'success' as const };
      }
    }

    const dispatcher = new Dagonizer<S, PaletteServices>({ services });
    dispatcher.registerNode(new UseServicesNode());
    const dag: DAGType = {
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
    assert.equal(result.state.lifecycle.variant, 'completed');
    assert.equal(result.state.out, 'https://example');
    assert.deepEqual(services.logger.entries, ['hit:https://example']);
  });

  void it('defaults services to undefined when no services record is supplied', async () => {
    class S extends NodeStateBase {
      out: unknown = 'unset';
    }

    const dispatcher = new Dagonizer<S>();
    dispatcher.registerNode(TestNode.make<S>('check-undefined', ['success'], (state, context) => {
      state.out = context.services;
      return 'success';
    }));
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
    assert.equal(result.state.lifecycle.variant, 'completed');
    assert.equal(result.state.out, undefined);
  });
});
