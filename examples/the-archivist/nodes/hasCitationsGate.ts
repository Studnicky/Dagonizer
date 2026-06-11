/**
 * hasCitationsGate: deterministic SPARQL ASK over the per-run state graph.
 *
 *   ASK FROM urn:dagonizer:state:<runId> {
 *     ?book dag:inShortlist "true"^^xsd:boolean .
 *     ?book dag:source      ?src .
 *   }
 *
 * The gate ignores the typed `state.shortlist` deliberately; it
 * reads from the canonical state graph so the rule is auditable
 * against the same triples a downstream PROV-O query would surface.
 *
 * Demonstrates the read path the user asked for: nodes that need a
 * cross-cutting fact `SPARQL`-query the state graph rather than
 * dereferencing typed fields.
 */

import { NodeOutputBuilder,
  EMPTY_CONTRACT_FRAGMENT,
  Timeout,
} from '@noocodex/dagonizer';
import type { NodeContextInterface, NodeInterface } from '@noocodex/dagonizer';

import { MemoryStore } from '../memory/MemoryStore.ts';
import type { ArchivistState } from '../ArchivistState.ts';
import type { ArchivistServices } from '../services.ts';

const dagSource      = MemoryStore.dagIri('source');
const dagInShortlist = MemoryStore.dagIri('inShortlist');

export class HasCitationsGateNode implements NodeInterface<ArchivistState, 'pass' | 'fail', ArchivistServices> {
  readonly contract = EMPTY_CONTRACT_FRAGMENT;
  readonly timeout = Timeout.none();
  readonly name = 'has-citations-gate';
  readonly outputs = ['pass', 'fail'] as const;

  async execute(state: ArchivistState, context: NodeContextInterface<ArchivistServices>) {
    const memory = context.services.memory;
    const graph = MemoryStore.stateGraphIri(state.runId);
    const shortlisted = memory.select({
      'subject':   '?book',
      'predicate': dagInShortlist,
      'object':    MemoryStore.lit.bool(true),
      'graph':     graph,
    });
    if (shortlisted.length === 0) {
      if (state.failureCause.trim().length === 0) {
        state.failureCause = 'No candidates found after searching all available sources. ';
      }
      return NodeOutputBuilder.of('fail');
    }
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
        return NodeOutputBuilder.of('pass');
      }
    }
    if (state.failureCause.trim().length === 0) {
      state.failureCause = 'No candidates found after searching all available sources. ';
    }
    return NodeOutputBuilder.of('fail');
  }
}

/** Backward-compatible const export for existing bundle/DAG references. */
export const hasCitationsGate = new HasCitationsGateNode();
