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

import { Batch, MonadicNode, NodeOutput, RoutedBatch } from '@studnicky/dagonizer';
import type { ItemType, NodeContextType, SchemaObjectType } from '@studnicky/dagonizer';

import { MemoryStore } from '../memory/MemoryStore.ts';
import type { ArchivistState } from '../ArchivistState.ts';
import type { ArchivistServices } from '../services.ts';

const dagSource      = MemoryStore.dagIri('source');
const dagInShortlist = MemoryStore.dagIri('inShortlist');

export class HasCitationsGateNode extends MonadicNode<ArchivistState, 'pass' | 'fail'> {
  private readonly services: ArchivistServices;
  readonly name = 'has-citations-gate';
  readonly outputs = ['pass', 'fail'] as const;
  override get outputSchema(): Record<'pass' | 'fail', SchemaObjectType> {
    return {
      'pass': { 'type': 'object' },
      'fail': { 'type': 'object' },
    };
  }

  constructor(services: ArchivistServices) {
    super();
    this.services = services;
  }

  override async execute(batch: Batch<ArchivistState>, _context: NodeContextType) {
    const passItems: ItemType<ArchivistState>[] = [];
    const failItems: ItemType<ArchivistState>[] = [];
    const memory = this.services.memory;

    for (const item of batch) {
      const { state } = item;
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
        const result = NodeOutput.create('fail');
        for (const error of result.errors) state.collectError(error);
        failItems.push(item);
        continue;
      }
      let passed = false;
      for (const row of shortlisted) {
        const book = row['book'];
        if (book === undefined) continue;
        const hasSource = memory.ask({
          'subject':   book,
          'predicate': dagSource,
          'graph':     graph,
        });
        if (hasSource) {
          passed = true;
          break;
        }
      }
      if (passed) {
        const result = NodeOutput.create('pass');
        for (const error of result.errors) state.collectError(error);
        passItems.push(item);
        continue;
      }
      if (state.failureCause.trim().length === 0) {
        state.failureCause = 'No candidates found after searching all available sources. ';
      }
      const result = NodeOutput.create('fail');
      for (const error of result.errors) state.collectError(error);
      failItems.push(item);
    }

    const routes: Array<readonly ['pass' | 'fail', Batch<ArchivistState>]> = [];
    if (passItems.length > 0) routes.push(['pass', Batch.from(passItems)]);
    if (failItems.length > 0) routes.push(['fail', Batch.from(failItems)]);
    return RoutedBatch.create(routes);
  }
}
