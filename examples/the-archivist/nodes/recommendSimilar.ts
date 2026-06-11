/**
 * recommendSimilar: deterministic seed node for the
 * `recommend-similar` branch.
 *
 * SPARQL across every `urn:dagonizer:state:<runId>` named graph other
 * than the current run, finds the most-recently-written shortlist that
 * is non-empty, picks the highest-scored title in it, and harvests
 * that title's `dag:subject` triples. The subjects become the new
 * `state.terms` so the existing `decide-tools → open-library-scout →
 * rank → ...` flow seeds from "what the visitor liked last time".
 *
 * Output routes:
 *   'seeded':   prior shortlist + subjects found; terms set; carry
 *                on with the normal pipeline.
 *   'empty':    no prior run is available; the DAG routes to the
 *                `compose-empty` terminal so the Archivist asks for a
 *                description of a previous read instead.
 */

import { NodeOutputBuilder,
  EMPTY_CONTRACT_FRAGMENT,
  Timeout,
} from '@noocodex/dagonizer';
import type { NodeContextInterface, NodeInterface } from '@noocodex/dagonizer';

import type { Binding } from '../memory/MemoryStore.ts';
import { MemoryStore, STATE_GRAPH_PREFIX } from '../memory/MemoryStore.ts';
import type { ArchivistState } from '../ArchivistState.ts';
import type { ArchivistServices } from '../services.ts';

const dagInShortlist  = MemoryStore.dagIri('inShortlist');
const dagScore        = MemoryStore.dagIri('score');
const dagTitle        = MemoryStore.dagIri('title');
const dagSubject      = MemoryStore.dagIri('subject');
const dagRunTimestamp = MemoryStore.dagIri('runTimestamp');

const MAX_TERMS = 6;

export class RecommendSimilarNode implements NodeInterface<ArchivistState, 'seeded' | 'empty', ArchivistServices> {
  readonly contract = EMPTY_CONTRACT_FRAGMENT;
  readonly timeout = Timeout.none();
  readonly name = 'recommend-similar';
  readonly outputs = ['seeded', 'empty'] as const;

  async execute(state: ArchivistState, context: NodeContextInterface<ArchivistServices>) {
    const memory = context.services.memory;
    const currentGraph = MemoryStore.stateGraphIri(state.runId).value;

    // Find every state graph except the current run.
    const graphs = memory.graphs()
      .filter((g) => g.value.startsWith(STATE_GRAPH_PREFIX) && g.value !== currentGraph);
    if (graphs.length === 0) {
      context.services.logger.info('recommend-similar: no prior state graphs');
      return NodeOutputBuilder.of('empty');
    }

    // Order graphs by their `dag:runTimestamp` literal so we pick the
    // most recent prior run first. Graph IRIs themselves carry no
    // ordering, so the timestamp is the only stable signal.
    interface Stamped { readonly graph: typeof graphs[number]; readonly ts: number }
    const stamped: Stamped[] = [];
    for (const graph of graphs) {
      const rows = memory.select({
        'subject':   '?run',
        'predicate': dagRunTimestamp,
        'object':    '?ts',
        'graph':     graph,
      });
      const tsRow = rows[0];
      const tsValue = tsRow?.['ts']?.value;
      const ts = tsValue !== undefined ? Number(tsValue) : 0;
      stamped.push({ graph, 'ts': Number.isFinite(ts) ? ts : 0 });
    }
    stamped.sort((a, b) => b.ts - a.ts);

    // Walk graphs newest-first looking for one with a non-empty
    // shortlist. The first hit wins.
    for (const { graph } of stamped) {
      const shortlisted: Binding[] = memory.select({
        'subject':   '?book',
        'predicate': dagInShortlist,
        'object':    MemoryStore.lit.bool(true),
        'graph':     graph,
      });
      if (shortlisted.length === 0) continue;

      // Pick the highest-scored book in this prior shortlist.
      let bestBook: { iri: ReturnType<typeof MemoryStore.iri>; score: number } | null = null;
      for (const row of shortlisted) {
        const book = row['book'];
        if (book === undefined) continue;
        const scoreRow = memory.select({
          'subject':   book,
          'predicate': dagScore,
          'object':    '?s',
          'graph':     graph,
        })[0];
        const raw = scoreRow?.['s']?.value;
        const score = raw !== undefined ? Number(raw) : 0;
        if (bestBook === null || score > bestBook.score) {
          bestBook = { 'iri': book, 'score': Number.isFinite(score) ? score : 0 };
        }
      }
      if (bestBook === null) continue;

      // Harvest title + subjects from the picked book.
      const titleRow = memory.select({
        'subject':   bestBook.iri,
        'predicate': dagTitle,
        'object':    '?title',
        'graph':     graph,
      })[0];
      const priorTitle = titleRow?.['title']?.value;
      const subjectRows = memory.select({
        'subject':   bestBook.iri,
        'predicate': dagSubject,
        'object':    '?s',
        'graph':     graph,
      });
      const subjects: string[] = [];
      for (const row of subjectRows) {
        const v = row['s']?.value;
        if (typeof v === 'string' && v.length > 0) subjects.push(v);
        if (subjects.length >= MAX_TERMS) break;
      }

      if (subjects.length === 0 && priorTitle === undefined) continue;

      state.terms = subjects.length > 0 ? subjects : (priorTitle !== undefined ? [priorTitle] : []);
      // Seed prior-context so the composeSimilar prompt can anchor the
      // similarity explicitly on the prior title.
      if (priorTitle !== undefined) {
        state.priorContext = [
          ...state.priorContext,
          { 'kind': 'anchor-title', 'text': priorTitle },
          ...subjects.map((s) => ({ 'kind': 'anchor-subject', 'text': s })),
        ];
      }
      context.services.logger.info(
        `recommend-similar: anchored on "${priorTitle ?? '<untitled>'}" (${String(subjects.length)} subjects)`,
      );
      return NodeOutputBuilder.of('seeded');
    }

    context.services.logger.info('recommend-similar: no prior shortlist with usable metadata');
    return NodeOutputBuilder.of('empty');
  }
}

/** Backward-compatible const export for existing bundle/DAG references. */
export const recommendSimilar = new RecommendSimilarNode();
