/**
 * 13-multibackend: DAG with two distinct container roles rendered with
 * per-role colors.
 *
 * PRIMARY DEMONSTRATION: MermaidRenderer emits two distinct classDef lines —
 * `classDef contained-cpu` and `classDef contained-io` — with different fills,
 * proving that multi-backend DAGs are visually separable by container role.
 * The output is printed to the console so the colors are visible.
 *
 * SECONDARY DEMONSTRATION (dual-backend execution): when `example:13` is run
 * via the compile-then-node path (see below), the DAG is executed over two
 * real backends:
 *   - `cpu` role: WorkerThreadContainer (thread pool) — squares items
 *   - `io` role:  ForkContainer (fork pool) — sums the squared results
 * Results are printed so correctness can be verified.
 *
 * Build + run requirements for dual-backend execution:
 *   tsc -p examples/tsconfig.multibackend.json
 *   node examples/dist/13-multibackend.js
 *
 * This file is compiled along with the registry by tsconfig.multibackend.json.
 * The `example:13` root script runs both steps in sequence.
 *
 * DAG definitions: examples/dags/13-multibackend.ts
 * Registry module: examples/dags/13-multibackend.registry.ts
 *
 * Run: pnpm example:13
 *   (or: tsc -p examples/tsconfig.multibackend.json && node examples/dist/13-multibackend.js)
 */

import { Dagonizer } from '@studnicky/dagonizer';
import { MermaidRenderer } from '@studnicky/dagonizer/viz';
import { ForkContainer, WorkerThreadContainer } from '@studnicky/dagonizer-executor-node';

import { dag, squareItemDag, SquareNode, SumNode, sumResultsDag, MultiBackendState } from './dags/13-multibackend.js';

// ---------------------------------------------------------------------------
// Part 1: Mermaid render — demonstrates per-role color classDefs
// ---------------------------------------------------------------------------

process.stdout.write('\n=== Per-role Mermaid classDefs ===\n\n');
const mermaid = MermaidRenderer.render(dag);
process.stdout.write(mermaid);
process.stdout.write('\n\n');

process.stdout.write('Lesson: two distinct classDef lines are emitted — one per container role.\n');
process.stdout.write('  classDef contained-cpu  → amber/thread-pool color\n');
process.stdout.write('  classDef contained-io   → rose-red/fork-pool color\n');
process.stdout.write('Different roles resolve to different palette slots via FNV-1a hash.\n\n');

// ---------------------------------------------------------------------------
// Part 2: Dual-backend execution — cpu (WorkerThread) + io (Fork)
// ---------------------------------------------------------------------------

// Registry module URL — compiled JS, not .ts
// import.meta.url resolves to the compiled file's location (examples/dist/).
// The registry lives at the same dist level: dist/dags/13-multibackend.registry.js.
const registryUrl = new URL('./dags/13-multibackend.registry.js', import.meta.url).href;

// #region containers
const cpuContainer = new WorkerThreadContainer({
  "registryModule":   registryUrl,
  "registryVersion":  '1.0.0',
  "poolSize":         2,
});

const ioContainer = new ForkContainer({
  "registryModule":   registryUrl,
  "registryVersion":  '1.0.0',
  "poolSize":         1,
});
// #endregion containers

// #region dispatcher
const dispatcher = new Dagonizer<MultiBackendState>({
  "containers": {
    "cpu": cpuContainer,  // WorkerThreadContainer: handles the ScatterNode body
    "io":  ioContainer,   // ForkContainer: handles the EmbeddedDAGNode
  },
});
dispatcher.registerNode(new SquareNode());
dispatcher.registerNode(new SumNode());
dispatcher.registerDAG(squareItemDag);
dispatcher.registerDAG(sumResultsDag);
dispatcher.registerDAG(dag);
// #endregion dispatcher

const state = new MultiBackendState();
state.tasks = [1, 2, 3, 4, 5];

process.stdout.write(`=== Dual-backend execution ===\n`);
process.stdout.write(`  input:  ${JSON.stringify(state.tasks)}\n`);
process.stdout.write(`  cpu container: WorkerThreadContainer (thread pool, 2 workers)\n`);
process.stdout.write(`  io  container: ForkContainer (fork pool, 1 worker)\n\n`);

await dispatcher.execute('multibackend', state);

// Sort results for deterministic display (scatter completion order varies by run).
const sorted = [...state.results].sort((a, b) => a - b);
process.stdout.write(`  results (squared, sorted): ${JSON.stringify(sorted)}\n`);
process.stdout.write(`  total (sum of squares):    ${state.total}\n`);

// Expected: [1, 4, 9, 16, 25] with total = 55
const expectedTotal = state.tasks.reduce((acc, n) => acc + n * n, 0);
process.stdout.write(`  expected total:            ${expectedTotal}\n`);
process.stdout.write(`  correct: ${state.total === expectedTotal}\n\n`);

process.stdout.write('Lesson: container: "cpu" on ScatterNode routes each item body to\n');
process.stdout.write('        WorkerThreadContainer; container: "io" on EmbeddedDAGNode\n');
process.stdout.write('        routes the sum step to ForkContainer. Two distinct backends,\n');
process.stdout.write('        two distinct Mermaid colors — visually and operationally separable.\n');

// Release both pools so the process exits cleanly.
await cpuContainer.destroy();
await ioContainer.destroy();
