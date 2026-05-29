# Examples

Runnable end-to-end examples. Each file is self-contained and exits 0.

```bash
npm install
npx tsx examples/01-linear.ts        # minimal stage chain
npx tsx examples/02-builder.ts       # DAGBuilder chainable API
npx tsx examples/03-schema.ts        # JSON load + Ajv validate + round-trip
npx tsx examples/04-fanout.ts        # ScatterNode over a source + partition gather
npx tsx examples/04b-scatter-collect.ts  # ScatterNode generate-and-select: map gather collects produced candidates
npx tsx examples/05-embedded-dags.ts     # ScatterNode singleton (sub-DAG body) + projection / map gather
npx tsx examples/06-cancellation.ts  # AbortSignal + deadlineMs
npx tsx examples/07-retry.ts         # RetryPolicy inside an operation
npx tsx examples/08-checkpoint.ts    # abort → snapshot → restore → resume
npx tsx examples/09-terminals.ts     # TerminalNode: explicit completed/failed endpoints, ScatterNode routing
npx tsx examples/10-shared-state.ts  # MemoryStore on the services bag + checkpoint round-trip
npx tsx examples/derive.ts           # DAGDeriver: contract-derived DAG + embeddedDAGs annotation (renders ScatterNode)
```

Or via npm scripts: `npm run example:01` … `example:10`, plus `example:derive` for the DAGDeriver showcase.
