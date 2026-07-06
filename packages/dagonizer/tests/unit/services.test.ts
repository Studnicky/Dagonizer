import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SchemaObjectType } from '../../src/contracts/NodeInterface.js';
import { MonadicNode } from '../../src/core/MonadicNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { Batch } from '../../src/entities/batch/Batch.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAGType } from '../../src/entities/index.js';
import type { NodeContextType } from '../../src/entities/node/NodeContext.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

class S extends NodeStateBase {
  out: string = '';
}

/** Logger injected via constructor — the DI model replacing the services container. */
class Logger {
  readonly entries: string[] = [];
  log(msg: string): void { this.entries.push(msg); }
}

/**
 * UseServicesNode: receives a Logger via constructor.
 * Proves that constructor DI replaces the services container pattern.
 */
class UseServicesNode extends MonadicNode<S, 'success'> {
  readonly name = 'use-services';
  readonly outputs = ['success'] as const;
  readonly #logger: Logger;

  constructor(logger: Logger) {
    super();
    this.#logger = logger;
  }

  override get outputSchema(): Record<'success', SchemaObjectType> {
    return { 'success': { 'type': 'object' } };
  }

  override async execute(batch: Batch<S>, _context: NodeContextType): Promise<Map<'success', Batch<S>>> {
    for (const item of batch) {
      this.#logger.log(`hit:${item.state.out}`);
      item.state.out = 'served';
    }
    return new Map([['success', batch]]);
  }
}

const SVC_DAG: DAGType = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:svc',
  '@type':    'DAG',
  'name': 'svc',
  'version': '1',
  'entrypoint': 'use-services',
  'nodes': [
    {
      '@id':   'urn:noocodex:dag:svc/node/use-services',
      '@type': 'SingleNode',
      'name':  'use-services',
      'node':  'use-services',
      'outputs': { 'success': 'end' },
    },
    { '@id': 'urn:noocodex:dag:svc/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
  ],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

void describe('Dagonizer constructor DI', () => {
  void it('node receives its dep via constructor and uses it during execution', async () => {
    const logger = new Logger();
    const node = new UseServicesNode(logger);

    const dispatcher = new Dagonizer<S>();
    dispatcher.registerNode(node);
    dispatcher.registerDAG(SVC_DAG);

    const state = new S();
    state.out = 'initial';

    const result = await dispatcher.execute('svc', state);

    assert.equal(result.state.lifecycle.variant, 'completed');
    assert.equal(result.state.out, 'served');
    assert.deepEqual(logger.entries, ['hit:initial'], 'logger injected via constructor must record the call');
  });

  void it('node without injected dep completes flow cleanly', async () => {
    class NoDepNode extends MonadicNode<S, 'success'> {
      readonly name = 'no-dep';
      readonly outputs = ['success'] as const;
      override get outputSchema(): Record<'success', SchemaObjectType> {
        return { 'success': { 'type': 'object' } };
      }
      override async execute(batch: Batch<S>, _ctx: NodeContextType): Promise<Map<'success', Batch<S>>> {
        for (const item of batch) item.state.out = 'done';
        return new Map([['success', batch]]);
      }
    }

    const dispatcher = new Dagonizer<S>();
    dispatcher.registerNode(new NoDepNode());
    dispatcher.registerDAG({
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:no-dep',
      '@type':    'DAG',
      'name': 'no-dep',
      'version': '1',
      'entrypoint': 'no-dep',
      'nodes': [
        {
          '@id':   'urn:noocodex:dag:no-dep/node/no-dep',
          '@type': 'SingleNode',
          'name':  'no-dep',
          'node':  'no-dep',
          'outputs': { 'success': 'end' },
        },
        { '@id': 'urn:noocodex:dag:no-dep/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    });

    const result = await dispatcher.execute('no-dep', new S());

    assert.equal(result.state.lifecycle.variant, 'completed');
    assert.equal(result.state.out, 'done');
  });
});
