/**
 * TypedRunStore: schema-narrowed per-run key-value store.
 *
 * Wraps the package's `MemoryStore` with `TypedStore<RunSchema>` to bind
 * known per-run keys to precise value types. Callers get typed `.get` and
 * `.set` without specifying `<T>` at every call site.
 *
 * Note: `memory/MemoryStore.ts` in this directory is an N3-backed triple
 * store. This file imports the package's `MemoryStore` from
 * `@studnicky/dagonizer/store` — a separate, unrelated export.
 */

// #region typed-store
import { MemoryStore, TypedStore } from '@studnicky/dagonizer/store';

/** Known per-run keys with their value types. */
interface RunSchema {
  query:    string;
  intent:   string;
  draft:    string;
  approved: boolean;
}

const inner = new MemoryStore({ namespace: 'run' });
const store = new TypedStore<RunSchema>(inner);

await store.set('query',    'books about machine learning');
await store.set('intent',   'on-topic');
await store.set('draft',    '');
await store.set('approved', false);

const query    = await store.get('query');
const intent   = await store.get('intent');
const approved = await store.get('approved');

await store.update('approved', () => true);
const approvedNow = await store.get('approved');

console.log('TypedRunStore: ok');
console.log(`  query:    ${query}`);
console.log(`  intent:   ${intent}`);
console.log(`  approved: ${approved} → ${approvedNow}`);
// #endregion typed-store
