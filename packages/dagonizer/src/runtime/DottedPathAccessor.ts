/**
 * DottedPathAccessor: default `StateAccessorInterface`.
 *
 * Extends `@studnicky/json`'s `Path` for proto-pollution-safe dot-path
 * traversal (`get`) and reuses its inherited `isSafeProperty` deny-list
 * for the hand-written auto-vivifying `set` traversal, since `Path` has
 * no `set` counterpart.
 */

import { Path } from '@studnicky/json';

import type { StateAccessorInterface } from '../contracts/StateAccessorInterface.js';

export class DottedPathAccessor extends Path implements StateAccessorInterface {
  // Narrow an arbitrary value to an indexable record at the traversal boundary
  // without a cast. `noun.is` type-guard, per the zero-cast rule: every dotted-
  // path step is gated through this predicate before the value is indexed.
  private static isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  get(state: object, path: string): unknown {
    const result = Path.get(state, path);
    return result === undefined ? null : result;
  }

  set(state: object, path: string, value: unknown): void {
    const parts = path.split('.');

    if (parts.length === 0) {
      return;
    }
    if (!DottedPathAccessor.isRecord(state)) {
      return;
    }
    let current: Record<string, unknown> = state;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];

      // Guard inline: refuse empty segments and keys that walk the prototype chain.
      if (part === undefined || part === '' || !DottedPathAccessor.isSafeProperty(part)) {
        return;
      }
      if (!(part in current)) {
        current[part] = {};
      }
      // Advance the cursor; the record guard refuses to write through a non-object intermediate.
      const next = current[part];
      if (!DottedPathAccessor.isRecord(next)) {
        return;
      }
      current = next;
    }
    const lastPart = parts[parts.length - 1];

    // Guard inline: refuse empty or forbidden final segment before assigning.
    if (lastPart !== undefined && lastPart !== '' && DottedPathAccessor.isSafeProperty(lastPart)) {
      current[lastPart] = value;
    }
  }
}
