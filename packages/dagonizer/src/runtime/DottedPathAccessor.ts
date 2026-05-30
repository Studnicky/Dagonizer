/**
 * DottedPathAccessor: default `StateAccessor`.
 *
 * Walks `path.split('.')` to read and write nested fields on a state
 * object. Creates intermediate plain objects on write when they are
 * absent. Treats `null` and `undefined` segments on read as misses,
 * returning `undefined`.
 *
 * Static class; no instances. The dispatcher consumes it through the
 * `StateAccessor` contract and may be configured with any other
 * implementation.
 */

import type { StateAccessor } from '../contracts/StateAccessor.js';

export class DottedPathAccessor implements StateAccessor {
  get(state: object, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = state;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  set(state: object, path: string, value: unknown): void {
    const parts = path.split('.');

    if (parts.length === 0) {
      return;
    }
    let current = state as Record<string, unknown>;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];

      if (part === undefined) {
        continue;
      }
      if (!(part in current)) {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }
    const lastPart = parts[parts.length - 1];

    if (lastPart !== undefined) {
      current[lastPart] = value;
    }
  }
}
