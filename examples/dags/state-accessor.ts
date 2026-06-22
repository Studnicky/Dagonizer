/**
 * state-accessor/dags: demonstrates DottedPathAccessor and the StateAccessorInterface
 * contract. Shows get/set on nested paths and how to wire a custom accessor
 * into a Dagonizer instance.
 *
 * Pure module: no side effects, no dispatcher execution.
 * Imported by examples/state-accessor.ts (the executable entry point).
 */

import { NodeStateBase } from '@studnicky/dagonizer';
import type { StateAccessorInterface } from '@studnicky/dagonizer/contracts';
import { DottedPathAccessor } from '@studnicky/dagonizer/runtime';

// ---------------------------------------------------------------------------
// Shared state shape used by all snippets in the entry
// ---------------------------------------------------------------------------

export class ArchiveState extends NodeStateBase {
  catalogue: Record<string, Record<string, string>> = {};
  archivist: Record<string, Record<string, string>> = {};
}

// #region contract-declaration
// StateAccessorInterface: get(target, path) → T | null; set(target, path, value) → void.
// Implementations are stateless; the same instance resolves every scatter source
// read, state-mapping input copy, and gather write.
export const dotAccessor: StateAccessorInterface = new DottedPathAccessor();
// #endregion contract-declaration

// #region custom-accessor
/**
 * PrefixAccessor: a custom StateAccessorInterface that silently adds a fixed namespace
 * prefix to every key before delegating to DottedPathAccessor.
 * Demonstrates the adapter contract: implement get + set, no callbacks.
 */
export class PrefixAccessor implements StateAccessorInterface {
  readonly #prefix: string;
  readonly #inner: DottedPathAccessor;

  constructor(prefix: string) {
    this.#prefix = prefix;
    this.#inner  = new DottedPathAccessor();
  }

  get(target: object, path: string): unknown {
    return this.#inner.get(target, `${this.#prefix}.${path}`);
  }

  set(target: object, path: string, value: unknown): void {
    this.#inner.set(target, `${this.#prefix}.${path}`, value);
  }
}
// #endregion custom-accessor

// #region dotted-get
// Read a nested value by dotted path; returns `null` on a miss.
export const accessor = new DottedPathAccessor();
// #endregion dotted-get

// #region dotted-set
// Write a nested value by dotted path; intermediate objects are auto-vivified.
export const writeAccessor = new DottedPathAccessor();
// #endregion dotted-set

// #region wire-accessor
// Pass any StateAccessorInterface to the Dagonizer constructor; scatter source reads
// and gather writes will use it for every execution.
export const prefixedAccessor = new PrefixAccessor('archivist');
// #endregion wire-accessor
