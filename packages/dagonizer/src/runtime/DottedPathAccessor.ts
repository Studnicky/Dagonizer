/**
 * DottedPathAccessor: default `StateAccessorInterface`.
 *
 * Walks `path.split('.')` to read and write nested fields on a state
 * object. Creates intermediate plain objects on write when they are
 * absent. Treats `null` and `undefined` segments on read as misses,
 * returning `undefined`.
 *
 * Static class; no instances. The dispatcher consumes it through the
 * `StateAccessorInterface` contract and may be configured with any other
 * implementation.
 */

import type { StateAccessorInterface } from '../contracts/StateAccessorInterface.js';

/**
 * Path segments that would walk or mutate the prototype chain. Reading or
 * writing through these would let a config-supplied path pollute
 * `Object.prototype`, so the accessor refuses to traverse them.
 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export class DottedPathAccessor implements StateAccessorInterface {
  // Narrow an arbitrary value to an indexable record at the traversal boundary
  // without a cast. `noun.is` type-guard, per the zero-cast rule: every dotted-
  // path step is gated through this predicate before the value is indexed.
  private static isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  get(state: object, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = state;

    for (const part of parts) {
      if (!DottedPathAccessor.isRecord(current)) {
        return null;
      }
      if (part === '' || FORBIDDEN_KEYS.has(part)) {
        return null;
      }
      current = current[part];
    }

    return current === undefined ? null : current;
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
      if (part === undefined || part === '' || FORBIDDEN_KEYS.has(part)) {
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
    if (lastPart !== undefined && lastPart !== '' && !FORBIDDEN_KEYS.has(lastPart)) {
      current[lastPart] = value;
    }
  }
}
