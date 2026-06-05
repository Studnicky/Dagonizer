/**
 * state-accessor/dags: demonstrates DottedPathAccessor and the StateAccessor
 * contract. Shows get/set on nested paths and how to wire a custom accessor
 * into a Dagonizer instance.
 *
 * Pure module: no side effects, no dispatcher execution.
 */

import { Dagonizer, NodeStateBase } from '@noocodex/dagonizer';
import type { StateAccessor } from '@noocodex/dagonizer/contracts';
import { DottedPathAccessor } from '@noocodex/dagonizer/runtime';

// ---------------------------------------------------------------------------
// Shared state shape used by all snippets
// ---------------------------------------------------------------------------

class ArchiveState extends NodeStateBase {
  catalogue: Record<string, Record<string, string>> = {};
}

// #region dotted-get
const accessor = new DottedPathAccessor();
const state = new ArchiveState();
state.catalogue = { shelves: { fiction: 'Shelf A' } };

// Read a nested value by dotted path; returns `undefined` on a miss.
const shelf = accessor.get(state, 'catalogue.shelves.fiction');
// shelf === 'Shelf A'
// #endregion dotted-get

// #region dotted-set
// Write a value at a dotted path, creating intermediate objects as needed.
accessor.set(state, 'catalogue.shelves.non-fiction', 'Shelf B');
// state.catalogue.shelves['non-fiction'] === 'Shelf B'
// #endregion dotted-set

// #region custom-accessor
/**
 * PrefixAccessor: a custom StateAccessor that silently adds an 'archivist:'
 * prefix to every key before delegating to DottedPathAccessor logic.
 * Demonstrates the adapter contract: implement get + set, no callbacks.
 */
class PrefixAccessor implements StateAccessor {
  readonly #prefix: string;
  readonly #inner: DottedPathAccessor;

  constructor(prefix: string) {
    this.#prefix = prefix;
    this.#inner = new DottedPathAccessor();
  }

  get(target: object, path: string): unknown {
    return this.#inner.get(target, `${this.#prefix}.${path}`);
  }

  set(target: object, path: string, value: unknown): void {
    this.#inner.set(target, `${this.#prefix}.${path}`, value);
  }
}
// #endregion custom-accessor

// #region wire-accessor
// Pass any StateAccessor to the Dagonizer constructor; scatter source reads
// and gather writes will use it for every execution.
const dispatcher = new Dagonizer({ accessor: new PrefixAccessor('archivist') });
// #endregion wire-accessor

// Suppress unused variable warnings.
void shelf;
void dispatcher;
