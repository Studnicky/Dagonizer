# Examples

Runnable end-to-end examples. Each file is self-contained and exits 0.

```bash
npm install
npx tsx examples/01-linear.ts            # minimal stage chain
npx tsx examples/02-builder.ts           # DAGBuilder chainable API
npx tsx examples/03-schema.ts            # JSON load + Ajv validate + round-trip
npx tsx examples/04-scatter.ts           # ScatterNode over a source + partition gather
npx tsx examples/04b-scatter-collect.ts  # ScatterNode generate-and-select: map gather collects produced candidates
npx tsx examples/04c-scatter-workers.ts  # ScatterNode with container binding (tsx-only; runs in-process without binding)
npx tsx examples/05-embedded-dags.ts     # EmbeddedDAGNode (sub-DAG body, cardinality 1) + stateMapping
npx tsx examples/06-cancellation.ts      # AbortSignal + deadlineMs
npx tsx examples/07-retry.ts             # RetryPolicy inside an operation
npx tsx examples/08-checkpoint.ts        # abort → snapshot → restore → resume
npx tsx examples/09-terminals.ts         # TerminalNode: explicit completed/failed endpoints, ScatterNode routing
npx tsx examples/10-shared-state.ts      # MemoryStore on the services bag + checkpoint round-trip
npx tsx examples/11-handoff.ts           # DAGHandoff envelope: two DAGs chained via InMemoryChannel
npx tsx examples/derive.ts               # DAGDeriver: contract-derived DAG + embeddedDAGs annotation (renders ScatterNode)
```

Pure-module reference files (no side effects beyond registry calls; import and inspect):

```bash
# examples/dags/scatter-extensions.ts  — TopNGatherStrategy + ThresholdReducer: custom gather + outcome-reducer
# examples/dags/state-accessor.ts      — PrefixAccessor: custom StateAccessor adapter contract
# examples/dags/store-remote.ts        — GrpcStore: custom RemoteStore (BaseStore subclass with gRPC stub)
# examples/dags/monadic-node.ts        — monadic node pattern: Err/Ok union result type
# examples/dags/virtual-clock.ts       — VirtualClockProvider + VirtualScheduler for deterministic time in tests
```

Worker examples require a compile step before running:
```bash
# 12-workers: ScatterNode over a real worker-thread pool
tsc -p examples/tsconfig.workers.json && node examples/dist/12-workers.js

# 13-multibackend: DAG with two distinct container roles (cpu + io)
tsc -p examples/tsconfig.multibackend.json && node examples/dist/13-multibackend.js
```

Or via npm scripts: `npm run example:01` … `example:13`, plus `example:derive` for the DAGDeriver showcase.
`04b` and `04c` are tsx-only (no dedicated npm script); run them directly with `npx tsx`.
