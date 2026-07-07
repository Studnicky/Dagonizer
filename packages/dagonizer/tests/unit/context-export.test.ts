import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ContextResolver, DAG_CONTEXT } from '../../src/context/index.js';
import { ContextResolver as DagContextResolver } from '../../src/dag/ContextResolver.js';

void describe('context subpath barrel', () => {
  void it('exports DAG_CONTEXT and ContextResolver', () => {
    assert.equal(ContextResolver, DagContextResolver);
    assert.equal(DAG_CONTEXT['@version'], 1.1);
    assert.equal(
      ContextResolver.expand('ctx:flow', { 'ctx': 'https://example.com/context#' }),
      'https://example.com/context#flow',
    );
  });
});
