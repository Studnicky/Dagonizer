---
"@studnicky/dagonizer": minor
---
Streaming producers feed a ScatterNode through one unified engine path — no
separate stream node, executor, or scheduler. A `StreamChannel<T>` is a bounded
push→pull async queue that is itself an `AsyncIterable<T>`, duck-typed as a
scatter source. Statics: `StreamChannel.driven(producer)`,
`StreamChannel.fanIn(producers)` (merge concurrent producers), and
`StreamChannel.resumable(producer, resumeAfter)` (supply only the remainder after
an interrupt). Producers are objects implementing `StreamProducerInterface`
(`produce(sink)`) or `ResumableStreamProducerInterface` (`produce(sink, resumeAfter)`)
pushing into a `StreamSinkInterface`; `DagStreamProducer<T>` (`./patterns`)
bridges an inner DAG's node-result stream into a back-pressured sink.

New public surface: `./channels` adds `StreamChannel`, `StreamCursor`,
`StreamChannelInterface`, and the option types; `./contracts` adds
`StreamProducerInterface`, `ResumableStreamProducerInterface`, and
`StreamSinkInterface`; `./patterns` adds `DagStreamProducer`.

Deterministic streamed resume: async/streaming sources are not engine
index-skipped (only array sources get the seen-indices pre-scan). The caller
reads the durable pull count with `StreamCursor.resumeAfter(state, scatterName)`
and supplies the remainder via `StreamChannel.resumable(producer, cursor)`. On
resume the engine replays in-flight inbox items from the checkpoint and the
channel supplies fresh items at or after the cursor; the union is exactly-once.
Acked items below the watermark are not re-folded — their gather contributions
must already live in the resumed state snapshot.

`GatherStrategy.initial(config, state, accessor)` is now invoked by the engine
once on fresh scatter entry (no stored checkpoint), before the first reduce, and
never on resume (where the accumulator is restored from the checkpoint). Built-in
gathers inherit the no-op default; state-sourced custom gathers seed their
accumulators here, which is what makes their durable cross-process resume
correct.
