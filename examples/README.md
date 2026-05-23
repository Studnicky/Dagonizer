# Examples

Runnable end-to-end examples. Each file is self-contained and exits 0.

```bash
npm install
npx tsx examples/01-linear.ts        # minimal stage chain
npx tsx examples/02-builder.ts       # DAGBuilder chainable API
npx tsx examples/03-schema.ts        # JSON load + Ajv validate + round-trip
npx tsx examples/04-fanout.ts        # fan-out + fan-in (partition strategy)
npx tsx examples/05-deepflows.ts     # nested DAG with state mapping
npx tsx examples/06-cancellation.ts  # AbortSignal + deadlineMs
npx tsx examples/07-retry.ts         # RetryPolicy inside an operation
npx tsx examples/08-checkpoint.ts    # abort → snapshot → restore → resume
npx tsx examples/09-terminals.ts     # TerminalNode: explicit completed/failed endpoints, deepDAG routing
npx tsx examples/10-shared-state.ts  # MemoryStore on the services bag + checkpoint round-trip
npx tsx examples/derive.ts           # DAGDeriver: contract-derived DAG + subDAGs annotation (DeepDAGNode placement)
```

Or via npm scripts: `npm run example:01` … `example:10`, plus `example:derive` for the DAGDeriver showcase.
