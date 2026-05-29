/**
 * 04b-scatter-collect — ScatterNode generate-and-select: fan out, collect
 * produced data with a `map` gather, then pick the best.
 *
 * This is the capability the old fan-out could not express: a plain fan-out
 * routed each clone by its output token but discarded the data the clone
 * produced. A `map` gather over a `source` keeps it — each clone writes a
 * field, and the gather appends those fields (in source-index order) into a
 * parent array. A downstream `select` node then chooses the winner.
 *
 * Flow:
 *   generate (ScatterNode over `providers`)
 *     ├─ one clone per provider; each provider node scores + writes
 *     │  clone.candidate = { provider, text, score }
 *     └─ gather: { strategy: 'map', mapping: { candidate: 'candidates' } }
 *        ⇒ parent.candidates = [candidate_0, candidate_1, …] (index-ordered)
 *   select (SingleNode)
 *     └─ reads parent.candidates, picks the highest score → parent.chosen
 *
 * Watch: every provider's produced candidate survives into state.candidates;
 * the select node picks the top score. With a plain fan-out the candidate
 * objects would have been thrown away.
 *
 * Run: npx tsx examples/04b-scatter-collect.ts
 */

import {
  DAG_CONTEXT,
  Dagonizer,
  NodeStateBase,
} from '@noocodex/dagonizer';
import type { DAG, NodeInterface } from '@noocodex/dagonizer';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// #region state
interface Candidate {
  provider: string;
  text:     string;
  score:    number;
}

class GenerateState extends NodeStateBase {
  providers:  string[]    = [];   // source array — one clone per provider
  candidate:  Candidate | null = null;  // per-clone produced field; the gather reads this off each clone
  candidates: Candidate[] = [];   // map-gather target — produced candidates land here (parent)
  chosen:     Candidate | null = null;  // the select node's winner
}
// #endregion state

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

// #region provider-node
// Runs once per provider clone. Reads the current provider from the itemKey
// metadata, produces a scored candidate, and writes it to the clone field
// `candidate`. The map gather collects each clone's `candidate` into the
// parent's `candidates` array in source-index order.
//
// The 'success' output token is what the default 'aggregate' reducer counts:
// every clone returning 'success' yields the 'all-success' route.
const provider: NodeInterface<GenerateState, 'success'> = {
  "name": 'provider',
  "outputs": ['success'],
  async execute(state) {
    const name = state.getMetadata<string>('provider') ?? 'unknown';
    // Deterministic pseudo-score so the example output is stable: score by
    // the provider name length plus a per-provider salt. In a real flow this
    // is an LLM/tool call producing a candidate answer + a quality score.
    const score = name.length * 10 + (name.charCodeAt(0) % 7);
    // Write to a clone field — the map gather reads `candidate` off each
    // clone via the StateAccessor and appends it into parent.candidates.
    state.candidate = {
      "provider": name,
      "text":     `answer from ${name}`,
      score,
    };
    return { "output": 'success' };
  },
};
// #endregion provider-node

// #region select-node
// Reads the collected candidates off parent state and picks the highest score.
const select: NodeInterface<GenerateState, 'selected' | 'none'> = {
  "name": 'select',
  "outputs": ['selected', 'none'],
  async execute(state) {
    if (state.candidates.length === 0) return { "output": 'none' };
    let best = state.candidates[0]!;
    for (const candidate of state.candidates) {
      if (candidate.score > best.score) best = candidate;
    }
    state.chosen = best;
    return { "output": 'selected' };
  },
};
// #endregion select-node

// ---------------------------------------------------------------------------
// DAG
// ---------------------------------------------------------------------------

// #region scatter-collect-placement
const dag: DAG = {
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
      "concurrency":  3,                               // up to 3 providers in-flight
      // map gather: read each clone's `candidate` metadata, append into
      // parent.candidates in source-index order. Because `source` is set, a
      // map gather appends (N clones ⇒ array); produced data survives.
      "gather": {
        "strategy": 'map',
        "mapping":  { "candidate": 'candidates' },     // cloneField → parentPath
      },
      // Aggregate outputs from the default 'aggregate' reducer. All providers
      // emit 'produced' (success), so 'all-success' fires → route to select.
      "outputs": {
        'all-success': 'select',
        "partial":     'select',
        'all-error':   null,
        "empty":       null,
      },
    },
    {
      '@id':     'urn:noocodex:dag:generate-select/node/select',
      '@type':   'SingleNode',
      "name":    'select',
      "node":    'select',
      "outputs": { "selected": null, "none": null },
    },
  ],
};
// #endregion scatter-collect-placement

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

// #region run
const dispatcher = new Dagonizer<GenerateState>();
dispatcher.registerNode(provider);
dispatcher.registerNode(select);
dispatcher.registerDAG(dag);

const state = new GenerateState();
state.providers = ['alpha', 'bravo', 'charlie', 'delta'];
await dispatcher.execute('generate-select', state);

process.stdout.write('\nScatter-collect — fan out over providers, collect candidates, select best\n');
process.stdout.write(`  providers:  ${JSON.stringify(state.providers)}\n`);
process.stdout.write(`  candidates: ${state.candidates.length} collected (none discarded)\n`);
for (const candidate of state.candidates) {
  process.stdout.write(`    - ${candidate.provider}: score ${candidate.score}\n`);
}
process.stdout.write(`  chosen:     ${state.chosen ? `${state.chosen.provider} (score ${state.chosen.score})` : 'none'}\n`);
process.stdout.write('\nLesson: a map gather over a source appends each clone\'s produced\n');
process.stdout.write('        field into a parent array — generate-and-select keeps the\n');
process.stdout.write('        data a plain fan-out would have thrown away.\n');
// #endregion run
