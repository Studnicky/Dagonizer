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
 * DAG definition (state, accessors, wired dispatcher): examples/dags/state-accessor.ts
 *
 * Run: npx tsx examples/state-accessor.ts
 */

import { NodeStateBase } from '@noocodex/dagonizer';
import { DottedPathAccessor } from '@noocodex/dagonizer/runtime';
import type { StateAccessor } from '@noocodex/dagonizer/contracts';
import { Dagonizer } from '@noocodex/dagonizer';

// ── PrefixAccessor: custom StateAccessor that namespaces every key ───────────

class PrefixAccessor implements StateAccessor {
  readonly #prefix: string;
  readonly #inner: DottedPathAccessor;

  constructor(prefix: string) {
    this.#prefix = prefix;
    this.#inner  = new DottedPathAccessor();
  }

  get<T = unknown>(target: object, path: string): T | null {
    return this.#inner.get<T>(target, `${this.#prefix}.${path}`);
  }

  set(target: object, path: string, value: unknown): void {
    this.#inner.set(target, `${this.#prefix}.${path}`, value);
  }
}

// ── Shared state shape ───────────────────────────────────────────────────────

class ArchiveState extends NodeStateBase {
  catalogue: Record<string, Record<string, string>> = {};
  archivist: Record<string, Record<string, string>> = {};
}

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
