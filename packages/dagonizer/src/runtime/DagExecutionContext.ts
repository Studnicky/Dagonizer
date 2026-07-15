/**
 * DagExecutionContext: per-execution correlation context, backed by a graph.
 *
 * `Dagonizer.execute()`/`resume()`/`executeBatch()` mint a fresh scope per run
 * (see `Dagonizer.dagExecutionScope()`), seeding it with a correlation id and
 * the running DAG's name. Any node body or lifecycle hook that holds the
 * run's `AbortSignal` (every `NodeContextType` carries one; every observability
 * hook fires with the signal for the event it reports) reads those values via
 * `DagExecutionContext.tryGet(signal, key)` — without threading them through
 * an extra constructor argument or ambient global.
 *
 * A node author who just wants "my run's correlation id" does not need to
 * know the reserved key name: `DagExecutionContext.correlationIdOf(context.signal)`
 * and `DagExecutionContext.dagNameOf(context.signal)` are shorthands for the
 * two well-known keys, discoverable directly off this class.
 *
 * ## Why not `AsyncLocalStorage`
 *
 * `node:async_hooks`' `AsyncLocalStorage` is Node-only, with no browser
 * equivalent and no `browser` conditional export in `@studnicky/context`
 * (the substrate package built on it). Dagonizer ships to the browser
 * (`dagonizer-executor-web`, browser embedders/stores, the docs site's Vue
 * runners), so a module-scope `AsyncLocalStorage` import anywhere in the
 * import graph breaks every browser bundle that pulls in
 * `@studnicky/dagonizer` at all.
 *
 * ## Why not a swapped "current" pointer
 *
 * A single static "current scope" pointer, swapped in and out around each
 * synchronous turn of a flow generator, only tracks the correct scope for the
 * SYNCHRONOUS portion of that turn. A node body that reads context after its
 * own first internal `await` observes whatever scope happened to be current
 * at that later moment — which, under concurrent `Execution`s interleaved on
 * the event loop (Dagonizer supports concurrent scatter execution), may
 * belong to a different run entirely. There is no way to make a single mutable
 * pointer correct across arbitrary `await` boundaries without true
 * continuation-local storage.
 *
 * ## The fix: an identity-keyed anchor, not a swapped pointer
 *
 * Every `NodeContextType` carries `signal: AbortSignal`, threaded explicitly
 * to every node's `execute()` call as a plain function parameter — correct
 * under any concurrency because it is not ambient state. Each run mints its
 * own `AbortSignal` (`Signal.compose()` in `Dagonizer.execute()`), and
 * distinct concurrent runs always get distinct `AbortSignal` instances, so a
 * `WeakMap<AbortSignal, string>` from a run's signal to its scope id is a
 * correct, object-identity-keyed anchor: given `context.signal` (or the
 * signal an observability hook fires with), `tryGet` looks up that anchor and
 * finds the right scope no matter how many `await`s ran first or what else is
 * interleaved on the event loop. `WeakMap` also means a signal that is no
 * longer referenced (its run long finished) does not pin its scope's entry in
 * memory.
 *
 * `withNodeTimeout` derives a fresh child `AbortSignal` per node with a
 * configured timeout budget; that child signal is not itself registered as a
 * scope owner. `DagExecutionScope.anchor()` records it to the same scope id,
 * so a timed node's `context.signal` resolves exactly like an untimed node's.
 *
 * ## Graph storage
 *
 * A scope is a subject IRI `urn:dagonizer:scope:{scopeId}`. Its bindings
 * (correlation id, DAG IRI) are quads on `urn:dagonizer:context:binding:{key}`;
 * an optional parent scope is a quad on `urn:dagonizer:context:parentScope`.
 * `tryGet` walks from the signal's scope up through `parentScope` links,
 * `select()`-ing one predicate at a time — there is no property-path query in
 * the narrow `TripleStoreInterface` this module uses internally, so a plain
 * loop over `select()` calls IS the traversal. Storage is an internal
 * `ExecutionGraphStore`, a minimal quad array with linear-scan pattern
 * matching (the same technique `dagonizer-patterns-graph`'s `RdfStore` uses,
 * scoped down to just `assert` + `select` + subject-prefix clearing).
 *
 * Read with `tryGet()`, never a throwing `get()`: a node's `execute()` may
 * legitimately run outside any scope (direct invocation in tests, a bare
 * `node.execute()` call), and `tryGet` returns `undefined` rather than
 * throwing in that case.
 *
 * ## Scope lifetime and cleanup
 *
 * Anchor-map entries (`AbortSignal → scopeId`) self-clean: `WeakMap` drops an
 * entry once its `AbortSignal` is no longer referenced. The quads themselves
 * do NOT — they are keyed by the `scopeId` string, and nothing about a
 * string going out of scope elsewhere is observable to the store. Without
 * explicit cleanup, every run's bindings would accumulate in the store for
 * the life of the process. Two mechanisms close this:
 *
 * - `Execution` calls `scope.terminate()` once the run's flow generator
 *   completes (or the `Execution` is otherwise torn down early — see its
 *   `finally` block), which drops this scope's own quads AND, via the
 *   `#children` membership tracked at scope-creation time, cascades to every
 *   descendant scope minted under it (embedded/nested runs that supplied
 *   this scope's signal as their `parentSignal`). Cascading through tracked
 *   `Set<scopeId>` membership is O(descendant count), not a full-store scan.
 * - As a backstop for any explicit-cleanup path that gets missed, root
 *   scopes (no parent) are also registered in a capacity-bounded
 *   `RootScopeRegistry` (an `LruCache` subclass, following
 *   `MemoryCheckpointStore`'s bounding pattern). Evicting the least-recently-
 *   touched root when capacity is exceeded clears that root's quads (and its
 *   descendants) the same way `terminate()` does, so the store cannot grow
 *   unboundedly even if a caller never drains an `Execution`.
 */

import { LruCache } from '@studnicky/cache';

import type { BindingType, QuadType, SlotPatternType, TermType } from '../contracts/TripleStoreInterface.js';

/** Reserved keys stored on `DagExecutionContext`. */
export const DagExecutionContextKeys = {
  'CORRELATION_ID': 'correlationId',
  'DAG_NAME': 'dagName',
  'DAG_IRI': 'dagIri',
  'RUN_IRI': 'runIri',
} as const;

/** Subject IRI prefix for scope nodes. */
const SCOPE_SUBJECT_PREFIX = 'urn:dagonizer:scope:';
/** Predicate IRI for the parent-scope link. */
const PARENT_SCOPE_PREDICATE = 'urn:dagonizer:context:parentScope';
/** Predicate IRI prefix for scope bindings; the binding key is appended. */
const BINDING_PREDICATE_PREFIX = 'urn:dagonizer:context:binding:';

/** Named node term for a scope's subject IRI. */
function scopeSubject(scopeId: string): TermType {
  return { 'termType': 'NamedNode', 'value': `${SCOPE_SUBJECT_PREFIX}${scopeId}` };
}

/** Named node term for a binding key's predicate IRI. */
function bindingPredicate(key: string): TermType {
  return { 'termType': 'NamedNode', 'value': `${BINDING_PREDICATE_PREFIX}${key}` };
}

/** Named node term for the parent-scope predicate IRI. Constant identity. */
const PARENT_SCOPE_PREDICATE_TERM: TermType = { 'termType': 'NamedNode', 'value': PARENT_SCOPE_PREDICATE };

/** Sentinel default-graph term; this module never uses named graphs. */
const DEFAULT_GRAPH: TermType = { 'termType': 'DefaultGraph', 'value': '' };

/**
 * Default capacity (max distinct root scopes) the LRU backstop retains
 * before evicting the least-recently-touched one. Exported for tests that
 * exercise the backstop directly; not part of the package's public surface.
 */
export const DEFAULT_EXECUTION_SCOPE_CAPACITY = 500;

/**
 * ExecutionGraphStore: minimal in-memory quad store backing
 * `DagExecutionContext`'s scope graph.
 *
 * A quad array with linear-scan `select()` pattern matching — the same
 * technique `dagonizer-patterns-graph`'s `RdfStore` uses against the full
 * `TripleStoreInterface`, scoped down here to just the operations the scope
 * graph needs: `assert` a binding or parent-link quad, `select` bound rows
 * for a one-slot lookup, and `clearRecursive` to drop a terminated scope's
 * quads (and every descendant scope's) so the store does not grow
 * unboundedly across many runs.
 *
 * Owns two membership structures alongside the quads themselves:
 * `#children` (parent scopeId → child scopeIds, populated as child scopes
 * are minted) drives `clearRecursive`'s cascade without a full-store scan;
 * `#roots` is a capacity-bounded `RootScopeRegistry` that evicts the
 * least-recently-touched ROOT scope (and cascades to its descendants) once
 * `DEFAULT_EXECUTION_SCOPE_CAPACITY` is exceeded — a backstop for any
 * explicit `clearRecursive` call that is missed.
 */
class ExecutionGraphStore {
  readonly #quads: QuadType[] = [];
  readonly #children = new Map<string, Set<string>>();
  readonly #roots: RootScopeRegistry;

  constructor() {
    this.#roots = RootScopeRegistry.of(this, DEFAULT_EXECUTION_SCOPE_CAPACITY);
  }

  assert(subject: TermType, predicate: TermType, object: TermType): void {
    this.#quads.push({ subject, predicate, object, 'graph': DEFAULT_GRAPH });
  }

  select(pattern: SlotPatternType): readonly BindingType[] {
    const bindings: BindingType[] = [];
    for (const quad of this.#quads) {
      const binding = ExecutionGraphStore.#matchQuad(quad, pattern);
      if (binding !== null) bindings.push(binding);
    }
    return bindings;
  }

  /** Track `childScopeId` as a child of `parentScopeId` for `clearRecursive`'s cascade. */
  registerChild(parentScopeId: string, childScopeId: string): void {
    const siblings = this.#children.get(parentScopeId);
    if (siblings === undefined) {
      this.#children.set(parentScopeId, new Set([childScopeId]));
    } else {
      siblings.add(childScopeId);
    }
  }

  /** Track `scopeId` in the capacity-bounded root registry. Root scopes only (no parent). */
  registerRoot(scopeId: string): void {
    this.#roots.set(scopeId, true);
  }

  /**
   * Drop `scopeId`'s own quads, then recursively drop every descendant
   * scope's quads (via `#children` membership — O(descendant count), not a
   * full-store scan), then drop the now-empty `#children` entries and the
   * root registry entry (a no-op when `scopeId` was never a root).
   */
  clearRecursive(scopeId: string): void {
    this.#clearSubject(scopeSubject(scopeId));
    const children = this.#children.get(scopeId);
    if (children !== undefined) {
      for (const childScopeId of children) {
        this.clearRecursive(childScopeId);
      }
      this.#children.delete(scopeId);
    }
    this.#roots.delete(scopeId);
  }

  /** Drop every quad whose subject is `subject`. */
  #clearSubject(subject: TermType): void {
    for (let i = this.#quads.length - 1; i >= 0; i -= 1) {
      const quad = this.#quads[i];
      if (quad !== undefined && quad.subject.value === subject.value) {
        this.#quads.splice(i, 1);
      }
    }
  }

  /** Match one quad against a `SlotPatternType`. See `RdfStore.#matchQuad`. */
  static #matchQuad(quad: QuadType, pattern: SlotPatternType): BindingType | null {
    const binding: Record<string, TermType> = {};
    for (const slot of ['subject', 'predicate', 'object', 'graph'] as const) {
      const patternSlot = pattern[slot];
      if (patternSlot === undefined) continue;
      const quadTerm = quad[slot];
      if (typeof patternSlot === 'string') {
        const varName = patternSlot.startsWith('?') ? patternSlot.slice(1) : patternSlot;
        binding[varName] = quadTerm;
      } else if (patternSlot.value !== quadTerm.value || patternSlot.termType !== quadTerm.termType) {
        return null;
      }
    }
    return binding;
  }
}

/**
 * RootScopeRegistry: capacity-bounded backstop over root scopeIds.
 *
 * Extends `@studnicky/cache`'s `LruCache` (the same bounding primitive
 * `MemoryCheckpointStore` uses) with the one override the base class exists
 * for: `onEvict` clears the evicted root's quads (cascading to its
 * descendants) from the owning `ExecutionGraphStore`, injected once at
 * construction — the standard DI pattern for an external dependency, not a
 * callback hook.
 */
class RootScopeRegistry extends LruCache<string, true> {
  readonly #store: ExecutionGraphStore;

  static of(store: ExecutionGraphStore, capacity: number): RootScopeRegistry {
    return new RootScopeRegistry(store, capacity);
  }

  private constructor(store: ExecutionGraphStore, capacity: number) {
    super({ capacity });
    this.#store = store;
  }

  protected override onEvict(scopeId: string, _reason: 'capacity'): void {
    this.#store.clearRecursive(scopeId);
  }
}

/**
 * One active correlation-context scope, returned by
 * `DagExecutionContext.initialize()`. Backed by the shared module-level
 * `ExecutionGraphStore` and `AbortSignal → scopeId` anchor map.
 */
export class DagExecutionScope {
  static readonly #store = new ExecutionGraphStore();
  static readonly #anchors = new WeakMap<AbortSignal, string>();

  /**
   * Resolve `signal` to its scope id via the anchor map, then walk the
   * `parentScope` chain looking up `key` at each scope until a binding is
   * found or the chain is exhausted. Returns `undefined` when `signal` has
   * no registered scope, or the chain has no binding for `key`.
   */
  static tryGet(signal: AbortSignal, key: string): string | undefined {
    const scopeId = DagExecutionScope.#anchors.get(signal);
    if (scopeId === undefined) return undefined;

    const predicate = bindingPredicate(key);
    let currentSubject: TermType | undefined = scopeSubject(scopeId);
    while (currentSubject !== undefined) {
      const bound = DagExecutionScope.#store.select({
        'subject':   currentSubject,
        'predicate': predicate,
        'object':    '?value',
      });
      const first = bound[0];
      if (first !== undefined) {
        const value = first['value'];
        if (value !== undefined) return value.value;
      }
      const parentRows = DagExecutionScope.#store.select({
        'subject': currentSubject,
        'predicate': PARENT_SCOPE_PREDICATE_TERM,
        'object': '?parent',
      });
      const parentRow = parentRows[0];
      currentSubject = parentRow !== undefined ? parentRow['parent'] : undefined;
    }
    return undefined;
  }

  /**
   * Register `signal` to the same scope as `existingSignal`. Used for
   * derived signals that represent the same logical run scope under narrower
   * cancellation semantics, such as the per-node child `AbortSignal`
   * `Dagonizer.withNodeTimeout` mints when a placement declares a timeout
   * budget. A no-op when `existingSignal` has no registered scope.
   */
  static anchor(signal: AbortSignal, existingSignal: AbortSignal): void {
    const scopeId = DagExecutionScope.#anchors.get(existingSignal);
    if (scopeId !== undefined) {
      DagExecutionScope.#anchors.set(signal, scopeId);
    }
  }

  /**
   * Mint a fresh scope, assert its `initial` bindings, optionally link it to
   * the scope owning `parentSignal` (when supplied and registered), and
   * anchor `signal` to it.
   */
  static of(initial: Readonly<Record<string, string>>, signal: AbortSignal, parentSignal?: AbortSignal): DagExecutionScope {
    const scopeId = globalThis.crypto.randomUUID();
    const subject = scopeSubject(scopeId);

    for (const [key, value] of Object.entries(initial)) {
      DagExecutionScope.#store.assert(subject, bindingPredicate(key), { 'termType': 'Literal', 'value': value });
    }

    const parentScopeId = parentSignal !== undefined ? DagExecutionScope.#anchors.get(parentSignal) : undefined;
    if (parentScopeId !== undefined) {
      DagExecutionScope.#store.assert(subject, PARENT_SCOPE_PREDICATE_TERM, scopeSubject(parentScopeId));
      DagExecutionScope.#store.registerChild(parentScopeId, scopeId);
    } else {
      DagExecutionScope.#store.registerRoot(scopeId);
    }

    DagExecutionScope.#anchors.set(signal, scopeId);
    return new DagExecutionScope(scopeId);
  }

  readonly #scopeId: string;

  private constructor(scopeId: string) {
    this.#scopeId = scopeId;
  }

  /** This scope's id, for callers minting a nested child scope. */
  get scopeId(): string {
    return this.#scopeId;
  }

  /**
   * Drop this scope's quads (bindings and parent link) and every descendant
   * scope's quads from the shared store — see `ExecutionGraphStore.clearRecursive`.
   * Anchor map entries are not explicitly removed — `WeakMap` drops them once
   * the owning `AbortSignal` is no longer referenced.
   */
  terminate(): void {
    DagExecutionScope.#store.clearRecursive(this.#scopeId);
  }
}

/**
 * Per-execution correlation context, shared across the package. A thin
 * static facade over `DagExecutionScope`.
 */
export class DagExecutionContext {
  private constructor() {}

  /**
   * Mint a fresh scope seeded with `initial`, anchored to `signal`, and
   * optionally linked as a child of the scope owning `parentSignal`. Called
   * once per `Dagonizer.execute()`/`resume()`/`executeBatch()` run (see
   * `Dagonizer.dagExecutionScope()`).
   */
  static initialize(
    initial: Readonly<Record<string, string>>,
    signal: AbortSignal,
    parentSignal?: AbortSignal,
  ): DagExecutionScope {
    return DagExecutionScope.of(initial, signal, parentSignal);
  }

  /**
   * Register `signal` to the same scope as `existingSignal`.
   */
  static anchor(signal: AbortSignal, existingSignal: AbortSignal): void {
    DagExecutionScope.anchor(signal, existingSignal);
  }

  /**
   * Read `key` from the scope anchored to `signal` (and its ancestors), or
   * `undefined` when `signal` has no registered scope or the key was never
   * bound. Never throws.
   */
  static tryGet(signal: AbortSignal, key: string): string | undefined {
    return DagExecutionScope.tryGet(signal, key);
  }

  /**
   * Shorthand for `tryGet(signal, DagExecutionContextKeys.CORRELATION_ID)` —
   * the run's correlation id, or `undefined` when `signal` carries no
   * registered scope (e.g. a node invoked directly, outside
   * `Dagonizer.execute()`/`resume()`).
   *
   * This is the discoverable entry point for a node author who wants "my
   * run's correlation id": `DagExecutionContext.correlationIdOf(context.signal)`.
   * Every `NodeContextType` carries `signal`, so this call is always in reach
   * from `execute(batch, context)`.
   */
  static correlationIdOf(signal: AbortSignal): string | undefined {
    return DagExecutionScope.tryGet(signal, DagExecutionContextKeys.CORRELATION_ID);
  }

  /**
   * Shorthand for `tryGet(signal, DagExecutionContextKeys.DAG_NAME)` — the
   * name of the DAG currently running under this scope, or `undefined` when
   * `signal` carries no registered scope. See {@link correlationIdOf}.
   */
  static dagNameOf(signal: AbortSignal): string | undefined {
    return DagExecutionScope.tryGet(signal, DagExecutionContextKeys.DAG_NAME);
  }

  static dagIriOf(signal: AbortSignal): string | undefined {
    return DagExecutionScope.tryGet(signal, DagExecutionContextKeys.DAG_IRI);
  }

  static runIriOf(signal: AbortSignal): string | undefined {
    return DagExecutionScope.tryGet(signal, DagExecutionContextKeys.RUN_IRI);
  }
}
