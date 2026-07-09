---
title: 'Example 35: Stream Resume Cursor'
description: 'The Cartographer resume scenario aborts a streaming scatter, reads StreamCursor.resumeAfter, and resumes from the durable cursor without duplicate processing.'
seeAlso:
  - text: 'Example 34: Intake stream source'
    link: './34-stream-channel'
    description: 'Cartographer source-intake gather stream assembly'
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

Stream Resume Cursor is the streaming counterpart to scatter resume. The Cartographer aborts a streaming scatter, reads `StreamCursor.resumeAfter(...)`, recreates the source stream from a durable cursor, and resumes without duplicate processing.

The source must be regenerable and ordered. Given that, Dagonizer can reconnect the resumed scatter to the right point in the stream.

## How It Works

The scatter stores durable progress in checkpoint state. On resume, `StreamCursor.resumeAfter(...)` converts that progress into a cursor for the stream producer. The producer regenerates the same ordered source, skips the consumed prefix, and yields only remaining items into the resumed scatter.

This divides responsibility cleanly: the scatter records what it has safely pulled and acknowledged; the producer knows how to rebuild the ordered stream after that point.

## Diagrams, Examples, and Outputs

### DAG registration and diagram

The [Cartographer](./the-cartographer) resume DAG uses the same streaming topology as the main DAG, but the scatter runs in item mode so abort can land between pulls. `StreamCursor.resumeAfter(state, 'process-stream')` reads the durable pull count from checkpoint state and feeds that cursor back into `CartographerSourceIntake.mergedFor(state, cursor)`.

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

The intake helper rebuilds the same ordered stream and skips the acknowledged prefix:

<<< @/../examples/the-cartographer/nodes/sourceIntake.ts#source-intake-helper

The intake gather is the DAG-visible convergence point before the resumable scatter:

<<< @/../examples/the-cartographer/core/SourceIntakeGather.ts#source-intake-gather

The CLI scenario aborts, resumes, and compares fingerprints:

<<< @/../examples/the-cartographer/runCartographer.ts#cartographer-resumable-scenario

## Details for Nerds

- **Durable pull cursor.** The cursor is based on scatter items durably pulled and acknowledged, not on producer push count.
- **Deterministic replay.** The producer regenerates the ordered stream and skips the consumed prefix.
- **No duplicate fold.** The resumed run’s regional-insight fingerprint matches the uninterrupted baseline.
- **Same browser graph shape.** Resume changes execution mode and cursor state, not the embedded DAG assembly model.

## Related Concepts

- [Example 34: Intake stream source](./34-stream-channel) - Cartographer source-intake gather stream assembly
- [Example 16: Scatter resume](./16-scatter-resume) - the same Cartographer resume DAG from the scatter perspective
- [Streaming Producers](../guide/streaming-producers) - full streaming API: driven, fanIn, resumable, DagStreamProducer
