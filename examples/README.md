# Examples

Runnable end-to-end examples. Each file is self-contained and exits 0.

```bash
npm install
npx tsx examples/01-linear.ts        # minimal stage chain
npx tsx examples/02-fanout.ts        # fan-out + fan-in (partition strategy)
npx tsx examples/03-subflows.ts      # nested DAG with state mapping
npx tsx examples/04-cancellation.ts  # AbortSignal + deadlineMs
npx tsx examples/05-retry.ts         # RetryPolicy inside an operation
npx tsx examples/06-builder.ts       # DAGBuilder chainable API
npx tsx examples/07-schema.ts        # JSON load + Ajv validate + round-trip
npx tsx examples/08-checkpoint.ts    # abort → snapshot → restore → resume
```

Or via npm scripts: `npm run example:01` … `example:08`.
