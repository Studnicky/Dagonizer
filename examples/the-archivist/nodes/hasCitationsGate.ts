/**
 * hasCitationsGate — deterministic SPARQL ASK over the per-run state graph.
 *
 *   ASK FROM urn:dagonizer:state:<runId> {
 *     ?book dag:inShortlist "true"^^xsd:boolean .
 *     ?book dag:source      ?src .
 *   }
 *
 * The gate ignores the typed `state.shortlist` deliberately — it
 * reads from the canonical state graph so the rule is auditable
 * against the same triples a downstream PROV-O query would surface.
 *
 * Demonstrates the read path the user asked for: nodes that need a
 * cross-cutting fact `SPARQL`-query the state graph rather than
 * dereferencing typed fields.
 */

import { MemoryStore, stateGraphIri } from '../memory/MemoryStore.ts';

import type { ArchivistNode } from './ArchivistNode.ts';

const dagSource      = MemoryStore.dagIri('source');
const dagInShortlist = MemoryStore.dagIri('inShortlist');

export const hasCitationsGate: ArchivistNode<'pass' | 'fail'> = {
  "name":    'has-citations-gate',
  "kind":    'deterministic',
  "outputs": ['pass', 'fail'],
  async execute(state, context) {
    const memory = context.services.memory;
    const graph = stateGraphIri(state.runId);
    const shortlisted = memory.select({
      'subject':   '?book',
      'predicate': dagInShortlist,
      'object':    MemoryStore.lit.bool(true),
      'graph':     graph,
    });
    if (shortlisted.length === 0) return { 'output': 'fail' };
    for (const row of shortlisted) {
      const book = row['book'];
      if (book === undefined) continue;
      const hasSource = memory.ask({
        'subject':   book,
        'predicate': dagSource,
        'graph':     graph,
      });
      if (hasSource) {
        context.services.logger.info(
          `gate pass: ${String(shortlisted.length)} shortlisted in state graph, ≥1 sourced`,
        );
        return { 'output': 'pass' };
      }
    }
    return { 'output': 'fail' };
  },
};
