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
 * DAG definition (GatherStrategy + OutcomeReducer registrations, ScoreNode, RankingState): examples/dags/scatter-extensions.ts
 *
 * Run: npx tsx examples/scatter-extensions.ts
 */

// Import triggers the registry.register calls for 'top-n' and 'threshold-75'.
import {
  RankingState,
  ScoreNode,
} from './dags/scatter-extensions.js';

import {
  DAG_CONTEXT,
  Dagonizer,
  GatherStrategies,
  OutcomeReducers,
} from '@studnicky/dagonizer';
import type { DAGType } from '@studnicky/dagonizer';

// ── DAG: scatter over items, gather with 'top-n', reduce with 'threshold-75' ─

const TOP_N_RANKING_DAG_IRI = 'urn:noocodec:dag:top-n-ranking';
const placement = (placementIdentifier: string): string => `${TOP_N_RANKING_DAG_IRI}/node/${encodeURIComponent(placementIdentifier)}`;

const dag: DAGType = {
  '@context':  DAG_CONTEXT,
  '@id': TOP_N_RANKING_DAG_IRI,
  '@type':     'DAG',
  name:        'top-n-ranking',
  version:     '1',
  entrypoints: { main: placement('rank-all') },
  nodes: [
    {
      '@id': placement('rank-all'),
      '@type':      'ScatterNode',
      name:         'rank-all',
      body:         { node: 'urn:noocodec:node:score' },
      source:       'items',
      itemKey:      'item',
      execution: { mode: 'item', concurrency: 5 },
      reducer:      'threshold-75',    // custom OutcomeReducer: >= 75% success
      outputs: {
        'all-success': placement('collect-top'),
        partial: placement('collect-top'),
        'all-error': placement('collect-top'),
        empty: placement('end'),
      },
    },
    {
      '@id': placement('collect-top'),
      '@type': 'GatherNode',
      name: 'collect-top',
      sources: { [placement('rank-all')]: {} },
      gather: {
        strategy: 'top-n',
        target:   'topCandidates',
      },
      outputs: { success: placement('end'), error: placement('end'), empty: placement('end') },
    },
    {
      '@id': placement('end'),
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
dispatcher.registerNode(new ScoreNode());
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

await dispatcher.execute(TOP_N_RANKING_DAG_IRI, state);

process.stdout.write(`topCandidates (top-3 by score):\n`);
for (const c of state.topCandidates) {
  process.stdout.write(`  { title: "${c.title}", score: ${String(c.score)} }\n`);
}

process.stdout.write('\nLesson: GatherStrategies.register + OutcomeReducers.register install\n');
process.stdout.write('        extension keys globally; DAG topology still routes by placement IRI.\n');
