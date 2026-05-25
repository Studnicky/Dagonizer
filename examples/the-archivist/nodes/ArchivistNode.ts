/**
 * ArchivistNode — `NodeInterface` extended with a `kind` tag.
 *
 *   deterministic     — pure computation; same input → same output.
 *                       Memory writes, gates, ranking, formatting.
 *   non-deterministic — depends on the world (LLM completion, the open
 *                       web). Two runs of the same input may differ.
 *
 * The live UI styles non-deterministic nodes with a dashed violet
 * border so the visitor can see, at a glance, which steps are pure and
 * which can drift between runs — the practical difference between
 * symbolic and sub-symbolic reasoning, drawn on the graph.
 *
 * `kind` is the Dagonizer extension; everything else is plain
 * `NodeInterface` and stays interchangeable with the engine.
 */


import type { ArchivistState } from '../ArchivistState.ts';
import type { ArchivistServices } from '../services.ts';

import type { NodeInterface } from '@noocodex/dagonizer';

export type NodeKind = 'deterministic' | 'non-deterministic';

export interface ArchivistNode<TOutput extends string>
  extends NodeInterface<ArchivistState, TOutput, ArchivistServices> {
  readonly kind: NodeKind;
}

/** Map node name → kind. Used by the cytoscape renderer to colour the graph. */
export const NODE_KINDS: Readonly<Record<string, NodeKind>> = {
  // Non-deterministic (added here so it sorts with its peers below)
  'recall-context':          'non-deterministic',
  'recall-memories':         'non-deterministic',
  'compose-memory-response': 'non-deterministic',
  // Deterministic
  'extract-query':         'deterministic',
  'recall-candidates':     'deterministic',
  'merge-candidates':      'deterministic',
  'record-findings':       'deterministic',
  'has-citations-gate':    'deterministic',
  'recall-past-visits':    'deterministic',
  'respond-to-visitor':    'deterministic',
  'decline-off-topic':     'deterministic',
  'decline-empty':         'deterministic',
  'group-by-year':         'deterministic',
  'recommend-similar':     'deterministic',
  'rank-by-rating':        'deterministic',
  'pick-best-match':       'deterministic',
  // Non-deterministic — every LLM-driven step
  'classify-intent':       'non-deterministic',
  'decide-tools':          'non-deterministic',
  'web-search-scout':      'non-deterministic',
  'open-library-scout':    'non-deterministic',
  'google-books-scout':    'non-deterministic',
  'wikipedia-scout':       'non-deterministic',
  'rank-candidates':       'non-deterministic',
  'compose-response':      'non-deterministic',
  'validate-response':     'non-deterministic',
  'find-reviews':          'non-deterministic',
  'compose-empty':         'non-deterministic',
};
