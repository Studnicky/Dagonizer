/**
 * state-accessor: demonstrates DottedPathAccessor and the custom PrefixAccessor
 * from dags/state-accessor.ts wired into a Dagonizer instance.
 *
 * DottedPathAccessor is the built-in path resolver used by scatter source reads
 * and gather writes. Consumers implement the StateAccessor contract to replace
 * it. PrefixAccessor (defined in dags/state-accessor.ts) prepends a fixed
 * namespace segment to every key before delegating to DottedPathAccessor.
 *
 * This example shows:
 *   1. Direct get/set via DottedPathAccessor on a concrete NodeStateBase.
 *   2. The same operations through PrefixAccessor.
 *   3. A Dagonizer constructed with the custom accessor (accessor option).
 *
 * DAG definition (ArchiveState, PrefixAccessor, accessors): examples/dags/state-accessor.ts
 *
 * Run: npx tsx examples/state-accessor.ts
 */

import { Dagonizer } from '@noocodex/dagonizer';
import { DottedPathAccessor } from '@noocodex/dagonizer/runtime';
import { ArchiveState, PrefixAccessor } from './dags/state-accessor.js';

process.stdout.write('\n=== StateAccessor: DottedPathAccessor + PrefixAccessor ===\n\n');

// ── 1. DottedPathAccessor: get and set on nested paths ──────────────────────

const dotted = new DottedPathAccessor();
const stateA  = new ArchiveState();

stateA.catalogue = { shelves: { fiction: 'Shelf A' } };

const fiction = dotted.get(stateA, 'catalogue.shelves.fiction');
process.stdout.write(`dotted.get('catalogue.shelves.fiction') = "${String(fiction)}"\n`);

dotted.set(stateA, 'catalogue.shelves.non-fiction', 'Shelf B');
const nonFiction = dotted.get(stateA, 'catalogue.shelves.non-fiction');
process.stdout.write(`dotted.set then get 'catalogue.shelves.non-fiction' = "${String(nonFiction)}"\n`);

// null on miss
const miss = dotted.get(stateA, 'catalogue.shelves.missing');
process.stdout.write(`dotted.get on missing path = ${JSON.stringify(miss)}\n`);

// ── 2. PrefixAccessor: every key is automatically prefixed ──────────────────

const prefix  = new PrefixAccessor('archivist');
const stateB  = new ArchiveState();

prefix.set(stateB, 'shelves.science', 'Shelf C');
const science = prefix.get(stateB, 'shelves.science');
process.stdout.write(`\nprefix.set('shelves.science') stored at 'archivist.shelves.science'\n`);
process.stdout.write(`prefix.get('shelves.science') = "${String(science)}"\n`);

// raw confirmation: value lives at the prefixed path
const raw = dotted.get(stateB, 'archivist.shelves.science');
process.stdout.write(`raw dotted.get('archivist.shelves.science') = "${String(raw)}"\n`);

// ── 3. Dagonizer constructed with the custom accessor ───────────────────────

const dispatcher = new Dagonizer<ArchiveState>({ accessor: prefix });
process.stdout.write(`\nDagonizer constructed with PrefixAccessor('archivist')\n`);
process.stdout.write(`typeof dispatcher = ${typeof dispatcher}\n`);

process.stdout.write('\nLesson: implement StateAccessor to swap the path resolver;\n');
process.stdout.write('        scatter reads and gather writes use the custom accessor.\n');

// #region gather-strategy
import {
  GatherStrategies,
  GatherStrategy,
  Batch,
} from '@noocodex/dagonizer';
import type { GatherRecord, NodeStateInterface } from '@noocodex/dagonizer';
import type { GatherConfig } from '@noocodex/dagonizer/entities';
import type { StateAccessor } from '@noocodex/dagonizer/contracts';

class AverageGather extends GatherStrategy {
  readonly name = 'average';
  reduce(
    config: GatherConfig,
    batch: Batch<GatherRecord<NodeStateInterface>>,
    state: NodeStateInterface,
    accessor: StateAccessor,
  ): void {
    if (config.target === undefined) return;
    const all: number[] = [];
    for (const item of batch) {
      all.push(accessor.get<number>(item.state.cloneState, config.field ?? 'score') ?? 0);
    }
    const avg = all.reduce((a, b) => a + b, 0) / Math.max(1, all.length);
    accessor.set(state, config.target, avg);
  }
}

// Register with the engine so it's available in DAG topology configs.
GatherStrategies.register(new AverageGather());
// #endregion gather-strategy
