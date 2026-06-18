/**
 * 12-workers: ScatterNode DAG running over a real worker-thread pool.
 *
 * Binds `containers: { cpu: new WorkerThreadContainer({...}) }` so that
 * each scatter item's sub-DAG ("square-item") executes inside an isolated
 * worker thread. The WorkerThreadContainer maintains a pool of Worker
 * instances, each running workerEntry.js (from dagonizer-executor-node),
 * which hosts a DagHost. DagHost dynamic-imports the registry module
 * (this demo's compiled JS registry) to reconstruct the identical bundle.
 *
 * Container vs. in-process: remove `container: 'cpu'` from the ScatterNode
 * in examples/dags/12-workers.ts and omit `containers` here to run the same
 * DAG entirely in-process. See examples/04-scatter.ts for the in-process
 * scatter pattern.
 *
 * Build + run requirements:
 *   The worker can only dynamic-import JavaScript (no tsx at runtime).
 *   The registry module is compiled to JS first:
 *     tsc -p examples/tsconfig.workers.json
 *   Then the demo runs as plain Node.js:
 *     node examples/dist/12-workers.js
 *
 * This file is compiled along with the registry by tsconfig.workers.json.
 * The `example:12` root script runs both steps in sequence:
 *   tsc -p examples/tsconfig.workers.json && node examples/dist/12-workers.js
 *
 * DAG definitions: examples/dags/12-workers.ts
 * Registry module: examples/dags/12-workers.registry.ts
 *
 * Run: pnpm example:12
 *   (or: tsc -p examples/tsconfig.workers.json && node examples/dist/12-workers.js)
 */

import { Dagonizer } from '@studnicky/dagonizer';
import { NodeSystemInfo, WorkerThreadContainer } from '@studnicky/dagonizer-executor-node';
import { RecommendedWorkerCountConfigDefault } from '@studnicky/dagonizer/entities';

import { dag, SquareWorkerNode, workerDag, WorkState } from './dags/12-workers.js';

// ---------------------------------------------------------------------------
// Registry module URL
//
// WorkerThreadContainer passes this URL to DagHost, which dynamic-imports
// it inside each worker thread. The file must be compiled JS — see the
// tsconfig.workers.json build step above.
//
// import.meta.url resolves to the compiled file's location (examples/dist/).
// The registry lives at the same dist level: dist/dags/12-workers.registry.js.
// ---------------------------------------------------------------------------

// #region registry-url
const registryUrl = new URL('./dags/12-workers.registry.js', import.meta.url).href;
// #endregion registry-url

// ---------------------------------------------------------------------------
// Pool sizing: NodeSystemInfo.recommendedWorkerCount
//
// recommendedWorkerCount probes os.availableParallelism() and os.freemem()
// to derive a cgroup-aware pool size. Spread RecommendedWorkerCountConfigDefault
// and override only the fields you want to clamp.
// ---------------------------------------------------------------------------

// #region pool-sizing
const sysInfo  = new NodeSystemInfo();
const poolSize = sysInfo.recommendedWorkerCount({
  ...RecommendedWorkerCountConfigDefault,
  maximumWorkers: 8,
});
process.stdout.write(`Pool sizing: recommendedWorkerCount = ${String(poolSize)} (capped at 8)\n`);
// #endregion pool-sizing

// ---------------------------------------------------------------------------
// Container: worker-thread pool, 2 workers
// ---------------------------------------------------------------------------

// #region container
const container = new WorkerThreadContainer({
  "registryModule":   registryUrl,
  "registryVersion":  '1.0.0',
  "poolSize":         2,
});
// #endregion container

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

// #region dispatcher
const dispatcher = new Dagonizer<WorkState>({
  // Bind the 'cpu' container role. The ScatterNode's `container: 'cpu'`
  // tells the engine to route each item's sub-DAG through this container
  // instead of running it in-process.
  "containers": { "cpu": container },
});
dispatcher.registerNode(new SquareWorkerNode());
dispatcher.registerDAG(workerDag);
dispatcher.registerDAG(dag);
// #endregion dispatcher

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const state = new WorkState();
// 30 items over a pool of 2 deliberately reuses each worker ~15 times — a scale
// check that the parent↔worker correlation holds (and adds no per-request
// listeners) when a worker is reused across many scatter units.
state.tasks = Array.from({ length: 30 }, (_, i) => i + 1);

process.stdout.write(`\nWorker-thread scatter: squaring ${state.tasks.length} items over a pool of 2 workers\n`);
process.stdout.write(`  input:  ${JSON.stringify(state.tasks)}\n`);

await dispatcher.execute('square-all', state);

process.stdout.write(`  output: ${JSON.stringify(state.results)}\n`);

// Release the worker pool so the process exits cleanly.
await container.destroy();

// Sort results for deterministic display (completion order varies by run).
const sorted = [...state.results].sort((a, b) => a - b);
process.stdout.write(`  output (sorted): ${JSON.stringify(sorted)}\n`);

process.stdout.write('\nLesson: container: "cpu" on the ScatterNode routes each item body\n');
process.stdout.write('        to a WorkerThreadContainer pool instead of running in-process.\n');
process.stdout.write('        Results arrive in worker-completion order; sort if needed.\n');
process.stdout.write('        The same DAG and state class work in both paths;\n');
process.stdout.write('        the only change is the container binding at construction.\n');
