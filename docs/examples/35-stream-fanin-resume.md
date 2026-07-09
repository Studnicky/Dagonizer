---
title: 'Example 35: Stream Resume Cursor'
description: 'The Cartographer resume scenario aborts a streaming scatter, reads StreamCursor.resumeAfter, and resumes from the durable cursor without duplicate processing.'
seeAlso:
  - text: 'Example 34: Producer feed DAGs'
    link: './34-stream-channel'
    description: 'Cartographer producer feed DAG assembly'
  - text: 'Example 16: Scatter resume'
    link: './16-scatter-resume'
    description: 'the same Cartographer resume DAG from the scatter perspective'
  - text: 'Streaming Producers'
    link: '../guide/streaming-producers'
    description: 'full streaming API: driven, fanIn, resumable, DagStreamProducer'
---

<script setup lang="ts">
import { cartographerResumeDAG } from '../.vitepress/theme/exampleDags.ts';
</script>

# Example 35: Stream Resume Cursor

## What It Is

Stream Resume Cursor is the streaming counterpart to scatter resume. The Cartographer aborts the canonical event scatter, reads `StreamCursor.resumeAfter(...)`, restores the canonical feed output and scatter checkpoint, and resumes without duplicate processing.

The source must be regenerable and ordered. Given that, Dagonizer can reconnect the resumed scatter to the right point in the stream.

## How It Works

The scatter stores durable progress in checkpoint state. On resume, `StreamCursor.resumeAfter(...)` reports the safe continuation point for `process-stream`; the restored `canonicalEvents` collection and scatter checkpoint let the dispatcher skip acknowledged items and replay only uncertain or remaining work.

This divides responsibility cleanly: the producer feed DAGs create canonical input, while the process scatter records what it has safely pulled and acknowledged.

## Diagrams, Examples, and Outputs

### DAG registration and diagram

The [Cartographer](./the-cartographer) resume DAG uses the same producer feed topology as the main DAG, but the enrichment scatter runs in item mode so abort can land between pulls. `StreamCursor.resumeAfter(state, 'process-stream')` reads the durable pull count from checkpoint state; resume continues from `process-stream` using the restored `canonicalEvents` array and scatter checkpoint.

<DagJsonMermaid :dag="cartographerResumeDAG" title="Cartographer resumable stream DAG" aria-label="Cartographer resumable stream JSON-LD DAG beside Mermaid generated from it." />

The graph shows the resumable scatter boundary. The code proves exactly-once behavior by comparing a full baseline fold to an interrupted-and-resumed fold.

### Run

```bash
npx tsx examples/the-cartographer/runCartographer.ts --stream
```

## What It Lets You Do

Stream resume cursors let applications restart a streaming scatter from the durable pull position instead of replaying already-folded items. Use this when a source can regenerate an ordered stream and the DAG must avoid duplicate processing after abort or crash.

This fits file cursors, event feeds, generated datasets, and model-produced work streams where the source can be reconstructed deterministically from a cursor.

## Code Samples

The producer feed DAGs create the canonical input before the resumable scatter:

<<< @/../examples/the-cartographer/embedded-dags/ProducerFeedDAG.ts#producer-feed-dags

The canonical open gather is the DAG-visible convergence point before the resumable scatter:

<<< @/../examples/the-cartographer/core/CanonicalFeedGather.ts#canonical-feed-gather

The CLI scenario aborts, resumes, and compares fingerprints:

<<< @/../examples/the-cartographer/runCartographer.ts#cartographer-resumable-scenario

## Details for Nerds

- **Durable pull cursor.** The cursor is based on scatter items durably pulled and acknowledged, not on producer push count.
- **Deterministic replay.** The restored canonical input plus scatter checkpoint gives the dispatcher the same ordered source items and progress state.
- **No duplicate fold.** The resumed run’s regional-insight fingerprint matches the uninterrupted baseline.
- **Same browser graph shape.** Resume changes execution mode and cursor state, not the embedded DAG assembly model.

## Related Concepts

- [Example 34: Producer feed DAGs](./34-stream-channel) - Cartographer producer feed DAG assembly
- [Example 16: Scatter resume](./16-scatter-resume) - the same Cartographer resume DAG from the scatter perspective
- [Streaming Producers](../guide/streaming-producers) - full streaming API: driven, fanIn, resumable, DagStreamProducer
