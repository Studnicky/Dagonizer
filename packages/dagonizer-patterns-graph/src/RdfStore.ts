/**
 * RdfStore — in-process triple store that implements both Store
 * (key-value via reification) and TripleStore (native quads).
 *
 * The Store-side `set(key, value)` reifies as a triple:
 *
 *   <urn:dagonizer:store:{key}> dag:value "{json-encoded-value}" .
 *
 * Plugin authors with richer RDF requirements (named graphs per key,
 * provenance, etc.) subclass and override the `keyToSubject` helper.
 *
 * Snapshot contract:
 *   `snapshot()` captures only the Store-reified quads (subject under the
 *   configured prefix, predicate matching valuePredicate). User-asserted
 *   quads on other predicates are NOT included in the snapshot — they are
 *   considered ephemeral graph data, not durable Store state. After
 *   `restore()`, user-asserted quads that were present before the restore
 *   are cleared alongside the reified ones; the backing array is fully
 *   replaced by the snapshot entries. This is the simplest safe default;
 *   plugin authors that need to preserve non-reified quads across restore
 *   should subclass and override `performRestoreEntries`.
 */

import { BaseStore, type BaseStoreOptions } from '@noocodex/dagonizer/store';
import type { StoreSnapshotEntry } from '@noocodex/dagonizer/contracts';
import type { JsonValue } from '@noocodex/dagonizer/entities';
import type { Binding, Quad, SlotPattern, Term, TripleStore } from '@noocodex/dagonizer/patterns';

/** Subject IRI prefix used when no override is supplied. */
const DEFAULT_SUBJECT_PREFIX = 'urn:dagonizer:store:';

/** Predicate IRI used for the reified Store value triple. */
const DEFAULT_VALUE_PREDICATE = 'urn:dagonizer:store:value';

/** Sentinel for the default RDF graph. */
const DEFAULT_GRAPH: Term = { termType: 'DefaultGraph', value: '' };

export interface RdfStoreOptions extends BaseStoreOptions {
  /**
   * Subject IRI prefix for reified Store keys.
   * Default: `'urn:dagonizer:store:'`.
   */
  readonly subjectPrefix?: string;
  /**
   * Predicate IRI used for the reified Store value triple.
   * Default: `'urn:dagonizer:store:value'`.
   */
  readonly valuePredicate?: string;
}

export class RdfStore extends BaseStore implements TripleStore {
  readonly #quads: Quad[];
  readonly #subjectPrefix:  string;
  readonly #valuePredicate: string;

  constructor(options: RdfStoreOptions = {}) {
    super({ namespace: options.namespace ?? '' });
    this.#quads          = [];
    this.#subjectPrefix  = options.subjectPrefix  ?? DEFAULT_SUBJECT_PREFIX;
    this.#valuePredicate = options.valuePredicate ?? DEFAULT_VALUE_PREDICATE;
  }

  protected get snapshotType(): string    { return 'rdf-store'; }
  protected get snapshotVersion(): number { return 1; }

  // ── Store contract (reified key-value over the quad graph) ──────────────────

  /**
   * Atomic RMW — reads directly from `#quads` without any intermediate
   * `await`, so no microtask can interleave between the read and the write.
   */
  override async update<T extends JsonValue>(
    key: string,
    fn: (current: T | undefined) => T,
  ): Promise<T> {
    const qualified = this.qualifyKey(key);
    const subject   = this.#keyToSubject(qualified);
    const current   = this.#readValue<T>(subject);
    const next      = fn(current);
    this.#writeValue(subject, next);
    return next;
  }

  protected async performGet<T extends JsonValue>(key: string): Promise<T | undefined> {
    return this.#readValue<T>(this.#keyToSubject(key));
  }

  protected async performSet<T extends JsonValue>(key: string, value: T): Promise<void> {
    this.#writeValue(this.#keyToSubject(key), value);
  }

  protected async performHas(key: string): Promise<boolean> {
    const subject = this.#keyToSubject(key);
    return this.#quads.some(
      (q) => q.subject.value === subject && q.predicate.value === this.#valuePredicate,
    );
  }

  protected async performDelete(key: string): Promise<boolean> {
    const subject = this.#keyToSubject(key);
    const before  = this.#quads.length;
    this.#removeQuadsMatching(subject, this.#valuePredicate);
    return this.#quads.length < before;
  }

  protected async performSnapshotEntries(): Promise<readonly StoreSnapshotEntry[]> {
    const entries: StoreSnapshotEntry[] = [];
    for (const quad of this.#quads) {
      if (quad.predicate.value !== this.#valuePredicate)      continue;
      if (!quad.subject.value.startsWith(this.#subjectPrefix)) continue;
      const rawKey = quad.subject.value.slice(this.#subjectPrefix.length);
      entries.push({
        key:   rawKey,
        value: JSON.parse(quad.object.value) as JsonValue,
      });
    }
    return entries;
  }

  protected async performRestoreEntries(entries: readonly StoreSnapshotEntry[]): Promise<void> {
    // Clear ALL quads (reified and user-asserted) then reseed from snapshot.
    // See module-level JSDoc for the trade-off rationale.
    this.#quads.length = 0;
    for (const { key, value } of entries) {
      this.#writeValue(this.#keyToSubject(key), value);
    }
  }

  // ── TripleStore contract (native quad operations) ────────────────────────────

  assert(subject: Term, predicate: Term, object: Term, graph?: Term): void {
    this.#quads.push({ subject, predicate, object, graph: graph ?? DEFAULT_GRAPH });
  }

  ask(pattern: SlotPattern): boolean {
    return this.select(pattern).length > 0;
  }

  select(pattern: SlotPattern): readonly Binding[] {
    const bindings: Binding[] = [];
    for (const quad of this.#quads) {
      const binding = matchQuad(quad, pattern);
      if (binding !== null) bindings.push(binding);
    }
    return bindings;
  }

  count(pattern: SlotPattern): number {
    return this.select(pattern).length;
  }

  clearGraph(graph: Term): void {
    for (let i = this.#quads.length - 1; i >= 0; i -= 1) {
      const quad = this.#quads[i];
      if (quad !== undefined && quad.graph.value === graph.value) {
        this.#quads.splice(i, 1);
      }
    }
  }

  *triples(): IterableIterator<Quad> {
    for (const quad of this.#quads) yield quad;
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  #keyToSubject(key: string): string {
    return `${this.#subjectPrefix}${key}`;
  }

  #readValue<T extends JsonValue>(subject: string): T | undefined {
    // Iterate backwards: the latest write wins.
    for (let i = this.#quads.length - 1; i >= 0; i -= 1) {
      const quad = this.#quads[i];
      if (quad === undefined)                        continue;
      if (quad.subject.value !== subject)             continue;
      if (quad.predicate.value !== this.#valuePredicate) continue;
      return JSON.parse(quad.object.value) as T;
    }
    return undefined;
  }

  #writeValue(subject: string, value: JsonValue): void {
    this.#removeQuadsMatching(subject, this.#valuePredicate);
    this.#quads.push({
      subject:   { termType: 'NamedNode', value: subject },
      predicate: { termType: 'NamedNode', value: this.#valuePredicate },
      object:    { termType: 'Literal',   value: JSON.stringify(value) },
      graph:     DEFAULT_GRAPH,
    });
  }

  #removeQuadsMatching(subject: string | undefined, predicate: string): void {
    for (let i = this.#quads.length - 1; i >= 0; i -= 1) {
      const quad = this.#quads[i];
      if (quad === undefined)                           continue;
      if (subject !== undefined && quad.subject.value !== subject) continue;
      if (quad.predicate.value !== predicate)           continue;
      this.#quads.splice(i, 1);
    }
  }
}

/**
 * Match a single quad against a SlotPattern.
 *
 * Returns `null` when the quad does not match. Returns a `Binding` (possibly
 * empty) when it does — variable slots (string values in the pattern) are
 * bound to the corresponding quad Term; constant slots (Term values in the
 * pattern) must match by both `termType` and `value`.
 *
 * The `graph` slot is matched when present in the pattern; when omitted the
 * quad's graph is unconstrained (it matches regardless of graph).
 */
function matchQuad(quad: Quad, pattern: SlotPattern): Binding | null {
  const binding: Record<string, Term> = {};

  for (const slot of ['subject', 'predicate', 'object', 'graph'] as const) {
    const patternSlot = pattern[slot];
    if (patternSlot === undefined) continue; // unconstrained — any value matches

    const quadTerm = quad[slot];

    if (typeof patternSlot === 'string') {
      // Variable slot — strip leading `?` to match the TripleStore.Binding convention
      // ("Keys are pattern-variable names without the leading `?`").
      const varName = patternSlot.startsWith('?') ? patternSlot.slice(1) : patternSlot;
      binding[varName] = quadTerm;
    } else if (
      patternSlot.value    !== quadTerm.value ||
      patternSlot.termType !== quadTerm.termType
    ) {
      return null; // constant mismatch
    }
  }

  return binding;
}
