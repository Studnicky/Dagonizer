/**
 * 04b-scatter-collect/dags: pure module — state, nodes, and DAG const.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/04b-scatter-collect.ts (the executable entry point).
 */

import {
  Batch,
  DAG_CONTEXT,
  MonadicNode,
  NodeOutput,
  NodeStateBase,
  RoutedBatch,
} from '@studnicky/dagonizer';
import type { DAGType, SchemaObjectType } from '@studnicky/dagonizer';
import { GatherStrategyNames } from '@studnicky/dagonizer/constants';

// #region state
export interface Candidate {
  provider: string;
  text:     string;
  score:    number;
}

/** Zero-value sentinel for an unset Candidate slot; score = -1 marks unset. */
const EMPTY_CANDIDATE: Candidate = { provider: '', text: '', score: -1 };

export class GenerateState extends NodeStateBase {
  providers:  string[]   = [];                            // source array; one clone per provider
  candidate:  Candidate  = { ...EMPTY_CANDIDATE };        // per-clone produced field; the gather reads this off each clone
  candidates: Candidate[] = [];                           // map-gather target; produced candidates land here (parent)
  chosen:     Candidate  = { ...EMPTY_CANDIDATE };        // the select node's winner; score -1 = no winner
}
// #endregion state

// #region provider-node
// Runs once per provider clone. Reads the current provider from the itemKey
// metadata, produces a scored candidate, and writes it to the clone field
// `candidate`. The map gather collects each clone's `candidate` into the
// parent's `candidates` array in source-index order.
//
// The 'success' output token is what the default 'aggregate' reducer counts:
// every clone returning 'success' yields the 'all-success' route.
export class ProviderNode extends MonadicNode<GenerateState, 'success'> {
  readonly name = 'provider';
  readonly outputs = ['success'] as const;
  override get outputSchema(): Record<'success', SchemaObjectType> {
    return { 'success': { 'type': 'object' } };
  }

  override async execute(batch: Batch<GenerateState>) {
    for (const item of batch) {
      const state = item.state;
      const name = state.getter.string('provider', 'unknown');
      // Deterministic pseudo-score so the example output is stable: score by
      // the provider name length plus a per-provider salt. In a real flow this
      // is an LLM/tool call producing a candidate answer + a quality score.
      const score = name.length * 10 + (name.charCodeAt(0) % 7);
      // Write to a clone field; the map gather reads `candidate` off each
      // clone via the StateAccessorInterface and appends it into parent.candidates.
      state.candidate = {
        "provider": name,
        "text":     `answer from ${name}`,
        score,
      };
    }
    return RoutedBatch.create(NodeOutput.create('success').output, batch);
  }
}
// #endregion provider-node

// #region select-node
// Reads the collected candidates off parent state and picks the highest score.
export class SelectNode extends MonadicNode<GenerateState, 'selected' | 'none'> {
  readonly name = 'select';
  readonly outputs = ['selected', 'none'] as const;
  override get outputSchema(): Record<'selected' | 'none', SchemaObjectType> {
    return { 'selected': { 'type': 'object' }, 'none': { 'type': 'object' } };
  }

  override async execute(batch: Batch<GenerateState>) {
    const entries: Array<readonly ['selected' | 'none', Batch<GenerateState>]> = [];
    for (const item of batch) {
      const state = item.state;
      if (state.candidates.length === 0) {
        entries.push([NodeOutput.create('none').output, Batch.from([item])]);
        continue;
      }
      const first = state.candidates[0];
      if (first === undefined) {
        entries.push([NodeOutput.create('none').output, Batch.from([item])]);
        continue;
      }
      let best = first;
      for (const candidate of state.candidates) {
        if (candidate.score > best.score) best = candidate;
      }
      state.chosen = best;
      entries.push([NodeOutput.create('selected').output, Batch.from([item])]);
    }
    return RoutedBatch.create(entries);
  }
}
// #endregion select-node

// #region scatter-collect-placement
export const dag: DAGType = {
  '@context':   DAG_CONTEXT,
  '@id':        'urn:noocodex:dag:generate-select',
  '@type':      'DAG',
  "name":         'generate-select',
  "version":      '1',
  "entrypoint":   'generate',
  "nodes": [
    {
      '@id':        'urn:noocodex:dag:generate-select/node/generate',
      '@type':      'ScatterNode',
      "name":         'generate',
      "body":         { "node": 'provider' },         // run provider once per clone
      "source":       'providers',                     // one clone per provider
      "itemKey":      'provider',                      // current provider bound under this key
      "execution": { "mode": "item", "concurrency": 3 },                               // up to 3 providers in-flight
      // map gather: read each clone's `candidate` metadata, append into
      // parent.candidates in source-index order. Because `source` is set, a
      // map gather appends (N clones ⇒ array); produced data survives.
      "gather": {
        "strategy": GatherStrategyNames.MAP,
        "mapping":  { "candidate": 'candidates' },     // cloneField → parentPath
      },
      // Aggregate outputs from the default 'aggregate' reducer. All providers
      // emit 'produced' (success), so 'all-success' fires → route to select.
      "outputs": {
        'all-success': 'select',
        "partial":     'select',
        'all-error':   'end',
        "empty":       'end',
      },
    },
    {
      '@id':     'urn:noocodex:dag:generate-select/node/select',
      '@type':   'SingleNode',
      "name":    'select',
      "node":    'select',
      "outputs": { "selected": 'end', "none": 'end' },
    },
    {
      '@id':     'urn:noocodex:dag:generate-select/node/end',
      '@type':   'TerminalNode',
      "name":    'end',
      "outcome": 'completed',
    },
  ],
};
// #endregion scatter-collect-placement
