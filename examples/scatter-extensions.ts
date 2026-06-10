/**
 * scatter-extensions: registers and uses the custom TopNGatherStrategy and
 * ThresholdReducer from dags/scatter-extensions.ts in a live scatter DAG.
 *
 * Importing dags/scatter-extensions.ts triggers the two side-effect
 * GatherStrategies.register / OutcomeReducers.register calls that install the
 * plugins into the global registries. A scatter DAG then references them by
 * name ('top-n' gather strategy, 'threshold-75' reducer).
 *
 * The worker node writes a scored { title, score } candidate to each clone's
 * state. TopNGatherStrategy collects the top-3 by score into state.topCandidates.
 * ThresholdReducer gates success on >= 75% of clones returning 'success'.
 *
 * DAG definition (GatherStrategy + OutcomeReducer registrations): examples/dags/scatter-extensions.ts
 *
 * Run: npx tsx examples/scatter-extensions.ts
 */

// Import triggers the registry.register calls for 'top-n' and 'threshold-75'.
import './dags/scatter-extensions.js';

import {
  DAG_CONTEXT,
  Dagonizer,
  GatherStrategies,
  NodeOutputBuilder,
  NodeStateBase,
  OutcomeReducers,
} from '@noocodex/dagonizer';
import type { DAG } from '@noocodex/dagonizer';
import type { NodeInterface } from '@noocodex/dagonizer/contracts';

// ── Domain state ─────────────────────────────────────────────────────────────

interface ScoredCandidate {
  readonly title: string;
  readonly score: number;
}

class RankingState extends NodeStateBase {
  items: string[]              = [];
  candidate: ScoredCandidate   = { title: '', score: 0 };
  topCandidates: ScoredCandidate[] = [];
}

// ── Worker node: produces a scored candidate from each item ──────────────────

const score: NodeInterface<RankingState, 'success' | 'error'> = {
  name:    'score',
  outputs: ['success', 'error'],
  async execute(state) {
    const item = state.getMetadata<string>('item') ?? '';
    // Synthetic score: proportional to string length
    state.candidate = { title: item, score: item.length };
    return NodeOutputBuilder.of('success');
  },
};

// ── DAG: scatter over items, gather with 'top-n', reduce with 'threshold-75' ─

const dag: DAG = {
  '@context':  DAG_CONTEXT,
  '@id':       'urn:noocodex:dag:top-n-ranking',
  '@type':     'DAG',
  name:        'top-n-ranking',
  version:     '1',
  entrypoint:  'rank-all',
  nodes: [
    {
      '@id':        'urn:noocodex:dag:top-n-ranking/node/rank-all',
      '@type':      'ScatterNode',
      name:         'rank-all',
      body:         { node: 'score' },
      source:       'items',
      itemKey:      'item',
      concurrency:  5,
      reducer:      'threshold-75',    // custom OutcomeReducer: >= 75% success
      gather: {
        strategy: 'top-n',            // custom GatherStrategy: top-3 by score
        target:   'topCandidates',
      },
      outputs: {
        'all-success': 'end',
        partial:       'end',
        'all-error':   'end',
        empty:         'end',
      },
    },
    {
      '@id':     'urn:noocodex:dag:top-n-ranking/node/end',
      '@type':   'TerminalNode',
      name:      'end',
      outcome:   'completed',
    },
  ],
};

// ── Verify plugins registered before dispatch ─────────────────────────────────

process.stdout.write('\n=== scatter-extensions: custom GatherStrategy + OutcomeReducer ===\n\n');
process.stdout.write(`Registered gather strategies: ${GatherStrategies.list().join(', ')}\n`);
process.stdout.write(`Registered outcome reducers:  ${OutcomeReducers.list().join(', ')}\n\n`);

// ── Run ──────────────────────────────────────────────────────────────────────

const dispatcher = new Dagonizer<RankingState>();
dispatcher.registerNode(score);
dispatcher.registerDAG(dag);

const state = new RankingState();
// Items with varying title lengths → varying scores
state.items = [
  'A',
  'Medium length title',
  'This is a longer candidate title',
  'Short',
  'Another medium item here',
  'x',
];

await dispatcher.execute('top-n-ranking', state);

process.stdout.write(`topCandidates (top-3 by score):\n`);
for (const c of state.topCandidates) {
  process.stdout.write(`  { title: "${c.title}", score: ${String(c.score)} }\n`);
}

process.stdout.write('\nLesson: GatherStrategies.register + OutcomeReducers.register install\n');
process.stdout.write('        plugins globally; scatter placements reference them by name.\n');
