/**
 * monadic-node: runs a concrete MonadicNode subclass end-to-end in a DAG.
 *
 * MonadicNode is the abstract base for every canonical DAG pattern. Concrete
 * subclasses declare `name`, `outputs`, and implement `execute` (or, as here,
 * a protected `run` method called by a logging intermediate class). Every code
 * path must return a declared output port — nothing throws past the node
 * boundary.
 *
 * The SearchCatalogueNode from dags/monadic-node.ts is registered on a tiny
 * two-placement DAG (search → end) and executed twice: once with a real query
 * (routes 'success') and once with an empty query (routes 'error').
 *
 * DAG definition (state, abstract base, concrete node): examples/dags/monadic-node.ts
 *
 * Run: npx tsx examples/monadic-node.ts
 */

import { DAG_CONTEXT, Dagonizer } from '@studnicky/dagonizer';
import type { DAGType } from '@studnicky/dagonizer';
import { CatalogueState, SearchCatalogueNode } from './dags/monadic-node.js';

// ── Build a minimal DAG: search-catalogue → end ─────────────────────────────

const dag: DAGType = {
  '@context':  DAG_CONTEXT,
  '@id':       'urn:noocodex:dag:catalogue-search',
  '@type':     'DAG',
  name:        'catalogue-search',
  version:     '1',
  entrypoints: { main: 'search' },
  nodes: [
    {
      '@id':   'urn:noocodex:dag:catalogue-search/node/search',
      '@type': 'SingleNode',
      name:    'search',
      node:    'search-catalogue',
      outputs: {
        success: 'end',
        empty:   'end',
        error:   'end',
      },
    },
    {
      '@id':     'urn:noocodex:dag:catalogue-search/node/end',
      '@type':   'TerminalNode',
      name:      'end',
      outcome:   'completed',
    },
  ],
};

// ── Dispatcher ───────────────────────────────────────────────────────────────

const dispatcher = new Dagonizer<CatalogueState>();
dispatcher.registerNode(new SearchCatalogueNode());
dispatcher.registerDAG(dag);

// ── Run 1: valid query → 'success' output, results populated ─────────────────

process.stdout.write('\n=== MonadicNode: concrete subclass in a live DAG ===\n\n');

const validState = new CatalogueState();
validState.query = 'Mechanicus Codex';
await dispatcher.execute('catalogue-search', validState);

process.stdout.write(`results: ${JSON.stringify(validState.results)}\n`);

// ── Run 2: empty query → 'error' output, results empty ───────────────────────

const emptyState = new CatalogueState();
emptyState.query = '';
await dispatcher.execute('catalogue-search', emptyState);

process.stdout.write(`results (empty query): ${JSON.stringify(emptyState.results)}\n`);

process.stdout.write('\nLesson: MonadicNode subclasses declare typed outputs;\n');
process.stdout.write('        every path returns a named port — nothing throws past the node.\n');
