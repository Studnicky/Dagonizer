# @noocodex/dagonizer

Omniscient orchestration for directed acyclic graphs. Type-safe nodes, abortable execution, deterministic resume. The backbone of the noocodex orchestration stack — consumers extend and compose; nothing is closed off.

## Concepts

- **Node** — discrete unit of work. Stateless. Declares named output ports, never throws, mutates state through a typed interface.
- **Node state** — the clipboard. Implements `NodeStateInterface`; flows through every node; collects errors and warnings without halting execution.
- **Placement** — a position in the graph referencing a registered node. Routes to next placements by mapping each output to a node name (or `null` to terminate).
- **DAG** — a named directed acyclic graph of placements with an entrypoint.

Placement kinds: `single` (one registered node), `parallel` (concurrent nodes with combine strategy), `fan-out` (one execution per source-array item, with fan-in), `sub-dag` (nested dispatcher invocation with state mapping).

## Install

```bash
npm install @noocodex/dagonizer
```

Node 24+. ESM only.

## Usage

```ts
import { Dagonizer, NodeStateBase } from '@noocodex/dagonizer';
import type { DAG, NodeInterface } from '@noocodex/dagonizer';

class GreetState extends NodeStateBase {
  greeting = '';
}

const greet: NodeInterface<GreetState, 'success'> = {
  name: 'greet',
  outputs: ['success'],
  async execute(state) {
    state.greeting = 'hello';
    return { output: 'success' };
  },
};

const dag: DAG = {
  name: 'demo',
  version: '1.0',
  entrypoint: 'greet',
  nodes: [
    { type: 'single', name: 'greet', node: 'greet', outputs: { success: null } },
  ],
};

const dispatcher = new Dagonizer<GreetState>();
dispatcher.registerNode(greet);
dispatcher.registerDAG(dag);

const result = await dispatcher.execute('demo', new GreetState());
console.log(result.state.greeting);       // 'hello'
console.log(result.state.lifecycle.kind); // 'completed'
console.log(result.cursor);               // null — DAG ran to completion
```

## Placement kinds

### Single

Routes per output.

```ts
{ type: 'single', name: 'classify', node: 'classify',
  outputs: { on_topic: 'plan', off_topic: 'reject', error: null } }
```

### Parallel

Concurrent registered nodes. The combine strategy maps individual outputs to a group output.

```ts
{ type: 'parallel', name: 'gather', nodes: ['fetchA', 'fetchB'],
  combine: 'all-success',  // | 'any-success' | 'collect' | …
  outputs: { success: 'merge', error: null } }
```

`collect` stores every node's output in `state.metadata.parallelOutputs` as `Record<nodeName, output>`. Custom combiners register via `ParallelCombiners.register(new MyCombiner())` — see [Pluggable combiners and fan-in strategies](#pluggable-combiners-and-fan-in-strategies) below.

### Fan-out

One execution per item in a state-array source. Fan-in collects results.

```ts
{ type: 'fan-out', name: 'scout', node: 'scoutOne',
  source: 'plan.tasks',        // dotted path into state
  itemKey: 'currentTask',      // metadata key the node reads
  concurrency: 3,
  fanIn: { strategy: 'append', target: 'scoutResults' },
  outputs: { 'all-success': 'merge', 'partial': 'merge', 'all-error': null, 'empty': null } }
```

Default fan-in strategies: `append` (flat-append all results to `target`), `partition` (route items by output name into distinct paths), `custom` (invoke a registered node with `fanInResults` metadata). Custom strategies extend `FanInStrategy` and register via `FanInStrategies.register(new MyFanIn())`.

### Sub-DAG

Invoke a nested DAG with optional input/output state mapping. Errors and warnings bubble up.

```ts
{ type: 'sub-dag', name: 'enrich', dag: 'enrichmentDAG',
  stateMapping: {
    // copies fields from parent state into child state before the sub-DAG runs
    input:  { 'targetUrl': 'currentItem.url' },
    // copies fields from child state back into parent after the sub-DAG returns
    output: { 'enrichedItem': 'result' },
  },
  outputs: { success: 'next', error: null } }
```

### DAGBuilder

Chainable authoring API that produces the same plain `DAG` the dispatcher consumes.

```ts
import { DAGBuilder } from '@noocodex/dagonizer/builder';

const dag = new DAGBuilder('demo', '1.0')
  .node('classify', classifyNode, { on_topic: 'plan', off_topic: 'reject', error: null })
  .node('plan',     planNode,     { success: null })
  .node('reject',   rejectNode,   { success: null })
  .build();
```

The first `.node()` call (or `.fanOut()`, `.parallel()`, `.subDAG()`) sets the entrypoint automatically. Call `.entrypoint(name)` to override.

## Streaming + sync-style execution

`dispatcher.execute()` returns an `Execution<TState>` that is both async-iterable and awaitable. One generator body runs exactly once regardless of which consumption mode you use.

```ts
// Sync-style — await the final summary.
const result = await dispatcher.execute('my-dag', state);

// Streaming — observe each node as it completes.
for await (const node of dispatcher.execute('my-dag', state)) {
  console.log(node.nodeName, node.output, node.skipped);
}
```

Intermediate results from parallel and sub-flow nodes are yielded before the aggregate result. Sub-flow node names are prefixed with the sub-flow node name (`parentNode.childNode`).

`result.cursor` is `null` when the flow ran to completion. When execution stopped early (abort, deadline, error, unwired output) `cursor` holds the name of the next node that would have run.

## Cancellation + deadlines

Pass `signal` and/or `deadlineMs` in the options argument.

```ts
const controller = new AbortController();
const result = await dispatcher.execute('my-dag', state, {
  signal:     controller.signal,
  deadlineMs: 5000,           // hard deadline — composed via AbortSignal.any()
});

if (result.cursor !== null) {
  const lc = result.state.lifecycle;
  if (lc.kind === 'cancelled') {
    console.log('aborted:', lc.reason);
  } else if (lc.kind === 'timed_out') {
    console.log('deadline exceeded at', lc.finishedAt);
  }
}
```

Nodes receive the composed signal via `context.signal`. Long-running IO should propagate it:

```ts
const fetchNode: NodeInterface<MyState, 'success' | 'error'> = {
  name: 'fetch',
  outputs: ['success', 'error'],
  async execute(state, context) {
    try {
      const res = await fetch(state.url, { signal: context.signal });
      state.body = await res.text();
      return { output: 'success' };
    } catch {
      return { output: 'error' };
    }
  },
};
```

`SignalComposer.compose({ signal, deadlineMs })` is the standalone helper the dispatcher uses internally; consumers can compose cancellation outside the dispatcher when needed.

```ts
import { SignalComposer } from '@noocodex/dagonizer/runtime';

const signal = SignalComposer.compose({ signal: ctrl.signal, deadlineMs: 5000 });
```

## Retry policy

`RetryPolicy` is per-node. Nodes construct their own instance and call `policy.run()` inside `execute()`.

```ts
import { RetryPolicy, BackoffStrategy } from '@noocodex/dagonizer/runtime';

class FetchNode implements NodeInterface<MyState, 'success' | 'error'> {
  readonly name = 'fetch';
  readonly outputs = ['success', 'error'] as const;
  private readonly policy = new RetryPolicy({
    maxAttempts: 3,
    strategy: BackoffStrategy.EXPONENTIAL,
    retryOn: [NetworkError],
    abortOn:  [AuthError],
  });

  async execute(state: MyState, context: NodeContextInterface) {
    try {
      const result = await this.policy.run(
        () => fetchData(state.url),
        context.signal,
      );
      state.data = result;
      return { output: 'success' };
    } catch {
      return { output: 'error' };
    }
  }
}
```

`BackoffStrategy` values: `CONSTANT`, `LINEAR`, `EXPONENTIAL`, `DECORRELATED_JITTER`. Delay is scheduled through `Scheduler.current()` so tests can install `VirtualScheduler` and drive retries deterministically.

## Services container

Nodes often need shared dependencies (loggers, clients, registries). Pass them at dispatcher construction; every node receives the same reference via `context.services`.

```ts
import { Dagonizer, NodeStateBase } from '@noocodex/dagonizer';
import type { NodeInterface, NodeContextInterface } from '@noocodex/dagonizer';

interface AppServices {
  readonly logger: { info(msg: string): void };
  readonly db: Database;
}

class S extends NodeStateBase {}

const fetchNode: NodeInterface<S, 'success', AppServices> = {
  name: 'fetch',
  outputs: ['success'],
  async execute(state, context) {
    context.services.logger.info('fetch start');
    const rows = await context.services.db.query('SELECT 1');
    state.setMetadata('rows', rows);
    return { output: 'success' };
  },
};

const dispatcher = new Dagonizer<S, AppServices>({
  services: { logger, db },
});
dispatcher.registerNode(fetchNode);
```

`TServices` defaults to `undefined` — nodes that don't depend on injected services work unchanged.

## State accessors

Fan-out source reads, fan-in writes, and sub-DAG state mapping all walk paths into state. The default `DottedPathAccessor` walks `path.split('.')`. Swap it via the constructor option:

```ts
import { Dagonizer } from '@noocodex/dagonizer';
import type { StateAccessor } from '@noocodex/dagonizer/contracts';

class JsonPointerAccessor implements StateAccessor {
  get(state: object, path: string): unknown { /* … */ }
  set(state: object, path: string, value: unknown): void { /* … */ }
}

const dispatcher = new Dagonizer<MyState>({ accessor: new JsonPointerAccessor() });
```

## Pluggable combiners and fan-in strategies

`ParallelCombiner` and `FanInStrategy` are abstract classes. Defaults register at module load (`all-success`, `any-success`, `collect`; `append`, `partition`, `custom`). Consumers extend the base class and call `Registry.register(new MyClass())`.

```ts
import { ParallelCombiner, ParallelCombiners } from '@noocodex/dagonizer/core';

class MajorityCombiner extends ParallelCombiner {
  readonly name = 'majority';
  combine(outputs: readonly string[]): string {
    const successes = outputs.filter((o) => o === 'success').length;
    return successes * 2 > outputs.length ? 'success' : 'error';
  }
}
ParallelCombiners.register(new MajorityCombiner());

// Then in a placement:
{ type: 'parallel', name: 'vote', nodes: ['a', 'b', 'c'],
  combine: 'majority', outputs: { success: 'next', error: null } }
```

```ts
import { FanInStrategy, FanInStrategies, type FanInExecution } from '@noocodex/dagonizer/core';
import type { NodeStateInterface } from '@noocodex/dagonizer';
import type { FanInConfig } from '@noocodex/dagonizer/entities';

class TopOneFanIn extends FanInStrategy {
  readonly name = 'top-one';
  async apply<TState extends NodeStateInterface>(
    config: FanInConfig,
    execution: FanInExecution<TState>,
  ): Promise<void> {
    const all = [...execution.results.values()].flat();
    execution.accessor.set(execution.state, config.target ?? 'top', all[0] ?? null);
  }
}
FanInStrategies.register(new TopOneFanIn());
```

The `custom` fan-in strategy uses `execution.invokeNode(name)` to dispatch a registered node back through the engine. Consumers' strategies do the same when they need to invoke a node.

## Checkpoint / resume

Checkpoint a flow that terminated early (non-null `cursor`), then resume it later.

```ts
import { Checkpoint } from '@noocodex/dagonizer/checkpoint';

const result = await dispatcher.execute('process', new MyState(), {
  signal: controller.signal,
});

if (result.cursor !== null) {
  const data = Checkpoint.from('process', result);
  await db.save('ckpt:process', Checkpoint.toJson(data));
}

// Later — resume:
const raw = JSON.parse(await db.load('ckpt:process'));
const { dagName, state, cursor } = Checkpoint.restore(
  raw,
  (snap) => MyState.restore(snap),
);
const finalResult = await dispatcher.resume(dagName, state, cursor);
```

For domain-specific state fields, override `snapshotData()` and `restoreData()` on `NodeStateBase`:

```ts
class MyState extends NodeStateBase {
  processed: string[] = [];

  protected override snapshotData() {
    return { processed: [...this.processed] };
  }

  protected override restoreData(snap: JsonObject) {
    const p = snap['processed'];
    if (Array.isArray(p)) this.processed = p as string[];
  }
}
```

Lifecycle resets to `pending` on restore. Resume starts a fresh lifecycle run on the existing state data.

### Checkpoint stores

`CheckpointStore` is the adapter contract for persistence backends.

```ts
import { Checkpoint, MemoryCheckpointStore } from '@noocodex/dagonizer/checkpoint';

const store = new MemoryCheckpointStore();              // for tests / demos
const data = Checkpoint.from('process', result);
await Checkpoint.persist(store, 'ckpt:1', data);

// Later:
const recalled = await Checkpoint.recall(store, 'ckpt:1', (snap) => MyState.restore(snap));
if (recalled !== null) {
  await dispatcher.resume(recalled.dagName, recalled.state, recalled.cursor);
}
```

`MemoryCheckpointStore` is for tests and ephemeral demos. Production deployments implement `CheckpointStore` against their database/object store of choice.

## Schema validation

DAGs can be loaded from JSON and validated before registration.

```ts
import { Dagonizer, ValidationError } from '@noocodex/dagonizer';
import { Validator } from '@noocodex/dagonizer/validation';

try {
  const dag = Dagonizer.load(jsonText);
  dispatcher.registerDAG(dag);
} catch (error) {
  if (error instanceof ValidationError) {
    console.error('Schema error:', error.message);
  }
}

if (Validator.dag.is(value)) {
  dispatcher.registerDAG(value);
}
```

`Validator` exposes one sub-validator per top-level entity: `dag`, `singleNode`, `parallelNode`, `fanOutNode`, `subDAGNode`, `fanInConfig`, `node`, `nodeContext`, `nodeOutput`, `nodeError`, `nodeWarning`, `nodeResult`, `nodeStateData`, `executionResult`, `dagLifecycleState`, `checkpoint`, `validationResult`, `dagErrorJson`. Each provides `.is(x)`, `.validate(x)`, and `.errors(x)`.

`registerDAG` runs the schema pre-pass internally before its semantic validation tier (node refs, output wiring, sub-DAG cycle detection).

`ValidationError` is a subclass of `DAGError` with `code: 'VALIDATION_ERROR'`. Use `instanceof ValidationError` to distinguish schema failures from operational errors.

## Observability via class extension

Subclass `Dagonizer` and override the protected hooks. Default implementations are no-ops.

```ts
import type { ExecutionResultInterface } from '@noocodex/dagonizer/types';

class TrackedDagonizer<TState extends NodeStateInterface, TServices = undefined>
  extends Dagonizer<TState, TServices>
{
  protected override onFlowStart(dagName: string, _state: TState): void {
    logger.info({ dagName }, 'DAG start');
  }

  protected override onFlowEnd(
    dagName: string,
    _state: TState,
    result: ExecutionResultInterface<TState>,
  ): void {
    logger.info({ dagName, cursor: result.cursor }, 'DAG end');
  }

  protected override onNodeStart(nodeName: string, _state: TState): void {
    logger.debug({ nodeName }, 'node start');
  }

  protected override onNodeEnd(
    nodeName: string,
    output: string | undefined,
    _state: TState,
  ): void {
    logger.debug({ nodeName, output }, 'node end');
  }

  protected override onError(nodeName: string, error: Error, _state: TState): void {
    logger.error({ nodeName, err: error }, 'node error');
  }
}
```

Class extension is the only extension mechanism. Multi-observer composition is a subclass concern — write it into your subclass.

## Validation

`registerDAG` rejects:

- Duplicate node names within a DAG
- Missing entrypoints
- Registered node references not previously registered
- Node outputs without a routing entry
- Routes targeting unknown nodes
- Fan-in strategy mismatches (e.g. `append` without `target`)
- Circular sub-DAG references

A JSON Schema pre-pass runs first (via `Validator.dag`) and catches structural issues before semantic validation.

## State lifecycle

`NodeStateBase` carries a five-event FSM: `pending → running → completed | failed | cancelled | timed_out`. The dispatcher marks `running` at flow start and the appropriate terminal state on exit. Illegal transitions throw `DAGError`.

The canonical accessor is `state.lifecycle.kind`. The lifecycle is a discriminated union — each branch carries the relevant timestamps and (for `failed`) the original `Error`.

```ts
const lc = result.state.lifecycle;
switch (lc.kind) {
  case 'completed': console.log('done in', lc.finishedAt - lc.startedAt, 'ms'); break;
  case 'failed':    console.error(lc.error); break;
  case 'cancelled': console.warn('cancelled:', lc.reason); break;
  case 'timed_out': console.warn('timed out at', lc.finishedAt); break;
}
```

Terminal states are sticky — once reached, all further lifecycle events are ignored.

## Errors

- `DAGError` — base class. Carries `code`, `context`, `timestamp`, `toJSON()`.
- `ConfigurationError` (`CONFIGURATION_ERROR`) — invalid flow or node configuration.
- `ExecutionError` (`EXECUTION_ERROR`) — error during flow execution.
- `NotFoundError` (`NOT_FOUND_ERROR`) — referenced node or flow not found.
- `ValidationError` (`VALIDATION_ERROR`) — JSON Schema validation failure.

## Clock and Scheduler

`Clock` is monotonic-only: `Clock.hrtime()` returns nanoseconds as `bigint`; `Clock.monotonicMs()` returns integer milliseconds. No wall-clock access is exposed.

`Scheduler.current()` returns a handle for scheduling delayed work. `RetryPolicy` uses it internally so tests can install `VirtualScheduler` and drive time deterministically.

```ts
import { VirtualClockProvider, VirtualScheduler } from '@noocodex/dagonizer/testing';
import { Clock, Scheduler } from '@noocodex/dagonizer/runtime';

const clock = new VirtualClockProvider(0n);
const scheduler = new VirtualScheduler(0);
Clock.configure(clock);
Scheduler.configure(scheduler);

clock.tickMs(1000);
scheduler.advance(1000);

Clock.reset();
Scheduler.reset();
```

`VirtualClockProvider` and `VirtualScheduler` are exported from `@noocodex/dagonizer/testing` and should not be imported in production code.

## Contract-derived flows

`FlowDeriver.derive` builds a `DAG` from a registry of `OperationContract`s by matching `produces ↔ hardRequired`. Adding an operation becomes a one-line registration; the topology updates automatically.

```ts
import { FlowDeriver } from '@noocodex/dagonizer/derive';
import type { OperationContract } from '@noocodex/dagonizer/contracts';

const contracts: OperationContract[] = [
  { name: 'classify',  hardRequired: ['input'],          produces: ['classification'] },
  { name: 'plan',      hardRequired: ['classification'], produces: ['plan'] },
  { name: 'scout',     hardRequired: ['plan'],           produces: ['scoutResults'] },
  { name: 'finalize',  hardRequired: ['scoutResults'],   produces: ['result'] },
];

const dag = FlowDeriver.derive({
  name: 'pipeline',
  version: '1.0',
  entrypoint: 'classify',
  contracts,
  annotations: {
    terminals: {
      classify: [{ outcome: 'off-topic', target: null }],
    },
  },
});

dispatcher.registerDAG(dag);
```

Operations sharing a depth become a `parallel` placement automatically. `annotations.terminals` declares alternate exits. `annotations.fanouts` wraps an operation in a fan-out placement (with a `customNode` fan-in operation).

## Visualization

`MermaidRenderer.render(dag)` emits Mermaid `flowchart` source for any `DAG`.

```ts
import { MermaidRenderer } from '@noocodex/dagonizer/viz';

const source = MermaidRenderer.render(dag);
console.log(source);
// flowchart LR
//   %% pipeline (v1.0)
//   classify
//   classify[classify]
//   classify -->|off-topic| END
//   classify -->|success| plan
//   …
//   END([end])
```

Single placements render as rectangles, fan-outs as hexagons, sub-dags as stadia, parallel placements as subgraphs. Routes targeting `null` route to a synthetic `END` terminator.

## Read accessors

`Dagonizer` exposes the registry for tooling and inspection:

```ts
const dag    = dispatcher.getDAG('pipeline');
const dags   = dispatcher.listDAGs();
const node   = dispatcher.getNode('classify');
const nodes  = dispatcher.listNodes();
```

Snapshots are independent shallow copies — mutating the returned arrays does not affect the registry.

## Exports

```ts
// Root barrel — classes, constants, errors, schemas, types
import {
  Dagonizer, NodeStateBase, Execution,
  Checkpoint, MemoryCheckpointStore,
  ParallelCombiner, ParallelCombiners,
  FanInStrategy, FanInStrategies,
  Clock, Scheduler, RetryPolicy, BackoffStrategy,
  Validator,
  DAGError, ConfigurationError, ExecutionError, NotFoundError, ValidationError,
  FanInStrategyName, FanOutOutput, MetadataKey, Output, ParallelCombine, NodeType,
} from '@noocodex/dagonizer';
import type { DAG, NodeInterface, NodeContextInterface, ExecutionResultInterface } from '@noocodex/dagonizer';

// Subpath imports
import type { /* every interface and entity-derived type */ } from '@noocodex/dagonizer/types';
import type { /* every adapter contract */ } from '@noocodex/dagonizer/contracts';
import { ParallelCombiner, FanInStrategy, ParallelCombiners, FanInStrategies } from '@noocodex/dagonizer/core';
import { FlowDeriver } from '@noocodex/dagonizer/derive';
import type { FlowAnnotations, OperationContract } from '@noocodex/dagonizer/derive';
import { MermaidRenderer } from '@noocodex/dagonizer/viz';
import { DAGError /* + subclasses */ } from '@noocodex/dagonizer/errors';
import { FanInStrategyName, FanOutOutput, MetadataKey, Output, ParallelCombine, NodeType } from '@noocodex/dagonizer/constants';
import { DAGLifecycleMachine } from '@noocodex/dagonizer/lifecycle';
import type { DAGLifecycleState, DAGLifecycleEvent } from '@noocodex/dagonizer/lifecycle';
import {
  Clock, Scheduler, SignalComposer, RetryPolicy, BackoffStrategy,
  RealTimeScheduler, DottedPathAccessor,
} from '@noocodex/dagonizer/runtime';
import { DAGBuilder } from '@noocodex/dagonizer/builder';
import { Validator } from '@noocodex/dagonizer/validation';
import { DAGSchema, CheckpointDataSchema, /* + per-shape schemas */ } from '@noocodex/dagonizer/entities';
import type { DAG, CheckpointData, /* + per-shape types */ } from '@noocodex/dagonizer/entities';
import { Checkpoint, MemoryCheckpointStore } from '@noocodex/dagonizer/checkpoint';
import { VirtualClockProvider, VirtualScheduler } from '@noocodex/dagonizer/testing'; // test-only
```

## License

MIT.
