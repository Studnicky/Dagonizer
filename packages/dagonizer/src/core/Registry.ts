/**
 * Registry: generic named-entry registry shared by `GatherStrategies` and
 * `OutcomeReducers`. Captures the register/replace/unregister/reset/resolve/
 * list contract and the duplicate-registration guard once; `GatherStrategies`
 * and `OutcomeReducers` extend it with their own built-in set and labels.
 */

import { DAGError } from '../errors/DAGError.js';

export abstract class Registry<TEntry extends { readonly name: string }> {
  private readonly registry: Map<string, TEntry>;
  private readonly builtins: ReadonlyArray<TEntry>;
  private readonly entryLabel: string;
  private readonly registryLabel: string;
  private readonly unknownLabel: string;

  /**
   * @param builtins - default entries seeded at construction and restored by `reset()`.
   * @param entryLabel - entry class name used in the duplicate-registration message (e.g. `'GatherStrategy'`).
   * @param registryLabel - registry class name used in the duplicate-registration message (e.g. `'GatherStrategies'`).
   * @param unknownLabel - lowercase noun used in the `resolve()` not-found message (e.g. `'gather strategy'`).
   */
  protected constructor(
    builtins: ReadonlyArray<TEntry>,
    entryLabel: string,
    registryLabel: string,
    unknownLabel: string,
  ) {
    this.builtins = builtins;
    this.entryLabel = entryLabel;
    this.registryLabel = registryLabel;
    this.unknownLabel = unknownLabel;
    this.registry = new Map(builtins.map((entry) => [entry.name, entry]));
  }

  /**
   * Register an entry. Throws `DAGError` when an entry with the same `name`
   * is already registered — protects against silent overwrite of built-ins
   * or consumer-registered entries. Use `replace()` for intentional
   * overrides (e.g. test-time substitution).
   */
  register(entry: TEntry): void {
    if (this.registry.has(entry.name)) {
      throw new DAGError(`${this.entryLabel} '${entry.name}' is already registered; use ${this.registryLabel}.replace() to intentionally override`);
    }
    this.registry.set(entry.name, entry);
  }

  /**
   * Explicitly replace an existing registration. Does not throw when the
   * name is already present. Use this for intentional test-time or
   * plugin-override substitution where overwriting an existing entry is
   * the deliberate goal.
   */
  replace(entry: TEntry): void {
    this.registry.set(entry.name, entry);
  }

  /**
   * Remove a previously registered entry by name. No-op if the name is
   * not present. Used in test `afterEach` to undo `register` calls and
   * prevent cross-test pollution of the global registry.
   */
  unregister(name: string): void {
    this.registry.delete(name);
  }

  /**
   * Reset the registry to the built-in entries, discarding any
   * consumer-registered entries. Used in test `afterEach` to restore a clean
   * baseline.
   */
  reset(): void {
    this.registry.clear();
    for (const entry of this.builtins) {
      this.registry.set(entry.name, entry);
    }
  }

  /**
   * Resolve an entry by name. Throws `DAGError` when no entry is
   * registered under `name`.
   */
  resolve(name: string): TEntry {
    const entry = this.registry.get(name);
    if (entry === undefined) {
      throw new DAGError(`Unknown ${this.unknownLabel}: ${name}`);
    }
    return entry;
  }

  /** Names of every registered entry, in registration order. */
  list(): readonly string[] {
    return [...this.registry.keys()];
  }
}
