/**
 * recallPastVisits: deterministic memory-recall node.
 *
 * SPARQL across every prior run's `urn:dagonizer:state:<runId>` named
 * graph to surface (a) the visitor's prior queries and (b) the books
 * those runs shortlisted. Pushes both into `state.priorContext` so the
 * composer can weave continuity commentary if relevant.
 *
 * The query is named-graph-aware: the current run's graph is excluded
 * so we never echo back the question the visitor just asked.
 */

import { NodeOutputBuilder, ScalarNode } from '@studnicky/dagonizer';
import type { NodeContextInterface } from '@studnicky/dagonizer';

import { MemoryStore, STATE_GRAPH_PREFIX } from '../memory/MemoryStore.ts';
import type { ArchivistState } from '../ArchivistState.ts';
import type { ArchivistServices } from '../services.ts';

const dagVisitorQuery = MemoryStore.dagIri('visitorQuery');
const dagTitle        = MemoryStore.dagIri('title');
const dagInShortlist  = MemoryStore.dagIri('inShortlist');

const MAX_PRIOR_QUERIES = 4;
const MAX_PRIOR_TITLES  = 6;

export class RecallPastVisitsNode extends ScalarNode<ArchivistState, 'recalled', ArchivistServices> {
  readonly name = 'recall-past-visits';
  readonly outputs = ['recalled'] as const;

  protected override async executeOne(state: ArchivistState, context: NodeContextInterface<ArchivistServices>) {
    const memory = context.services.memory;
    const currentGraph = MemoryStore.stateGraphIri(state.runId).value;

    // Pull every prior visitorQuery across every state graph (graph is
    // unbound in the pattern, so we get the binding back per row).
    const queryRows = memory.select({
      'subject':   '?run',
      'predicate': dagVisitorQuery,
      'object':    '?text',
      'graph':     '?graph',
    });
    const priorQueries: { graph: string; text: string }[] = [];
    for (const row of queryRows) {
      const graphTerm = row['graph'];
      const textTerm = row['text'];
      if (graphTerm === undefined || textTerm === undefined) continue;
      if (!graphTerm.value.startsWith(STATE_GRAPH_PREFIX)) continue;
      if (graphTerm.value === currentGraph) continue;
      priorQueries.push({ 'graph': graphTerm.value, 'text': textTerm.value });
    }
    // Keep most recent; graph IRIs aren't ordered, use insertion order
    // and trim to MAX_PRIOR_QUERIES.
    const recentQueries = priorQueries.slice(-MAX_PRIOR_QUERIES);

    // For each of those runs, pull the books that were shortlisted.
    const titles = new Set<string>();
    for (const q of recentQueries) {
      const titleRows = memory.select({
        'subject':   '?book',
        'predicate': dagInShortlist,
        'object':    MemoryStore.lit.bool(true),
        'graph':     MemoryStore.iri(q.graph),
      });
      for (const row of titleRows) {
        const book = row['book'];
        if (book === undefined) continue;
        const titleRow = memory.select({
          'subject':   book,
          'predicate': dagTitle,
          'object':    '?title',
          'graph':     MemoryStore.iri(q.graph),
        })[0];
        const title = titleRow?.['title']?.value;
        if (title !== undefined) titles.add(title);
        if (titles.size >= MAX_PRIOR_TITLES) break;
      }
      if (titles.size >= MAX_PRIOR_TITLES) break;
    }

    const priorContext: { kind: string; text: string }[] = [];
    for (const q of recentQueries) priorContext.push({ 'kind': 'prior-query',          'text': q.text });
    for (const t of titles)        priorContext.push({ 'kind': 'prior-recommendation', 'text': t });
    state.priorContext = priorContext;

    if (priorContext.length > 0) {
      context.services.logger.info(
        `recall: ${String(recentQueries.length)} prior queries, ${String(titles.size)} prior titles (across ${String(recentQueries.length)} state graphs)`,
      );
    }
    return NodeOutputBuilder.of('recalled');
  }
}

/** Singleton node instance referenced by the DAG wiring. */
export const recallPastVisits = new RecallPastVisitsNode();
