/**
 * 04b-scatter-collect: ScatterNode generate-and-select: scatter, collect
 * produced data with a `map` gather, then pick the best.
 *
 * A `map` gather over a `source` keeps produced clone data; each clone
 * writes a field, and the gather appends those fields (in source-index order)
 * into a parent array. A downstream `select` node then chooses the winner.
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
 * the select node picks the top score.
 *
 * DAG definition (state, provider/select nodes, dag): examples/dags/04b-scatter-collect.ts
 *
 * Run: npx tsx examples/04b-scatter-collect.ts
 */

import { Dagonizer } from '@studnicky/dagonizer';
import { GenerateState, ProviderNode, SelectNode, dag } from './dags/04b-scatter-collect.js';

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

// #region run
const dispatcher = new Dagonizer<GenerateState>();
dispatcher.registerNode(new ProviderNode());
dispatcher.registerNode(new SelectNode());
dispatcher.registerDAG(dag);

const state = new GenerateState();
state.providers = ['alpha', 'bravo', 'charlie', 'delta'];
await dispatcher.execute('generate-select', state);

process.stdout.write('\nScatter-collect: scatter over providers, collect candidates, select best\n');
process.stdout.write(`  providers:  ${JSON.stringify(state.providers)}\n`);
process.stdout.write(`  candidates: ${state.candidates.length} collected (none discarded)\n`);
for (const candidate of state.candidates) {
  process.stdout.write(`    - ${candidate.provider}: score ${candidate.score}\n`);
}
process.stdout.write(`  chosen:     ${state.chosen.score >= 0 ? `${state.chosen.provider} (score ${state.chosen.score})` : 'none'}\n`);
process.stdout.write('\nLesson: a map gather over a source appends each clone\'s produced\n');
process.stdout.write('        field into a parent array; generate-and-select preserves\n');
process.stdout.write('        data from every scatter clone.\n');
// #endregion run
