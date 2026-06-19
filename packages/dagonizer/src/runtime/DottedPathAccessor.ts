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
  get<T = unknown>(state: object, path: string): T | null {
    const parts = path.split('.');
    let current: unknown = state;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return null;
      }
      if (part === '' || FORBIDDEN_KEYS.has(part)) {
        return null;
      }
      // State-traversal boundary: `current` is verified non-null/undefined above
      // and is a plain object at every step of the path; the cast to
      // `Record<string, unknown>` is the single permitted ingest point for
      // dotted-path traversal over arbitrary state objects.
      current = (current as Record<string, unknown>)[part];
    }

    if (current === undefined) {
      return null;
    }
    return current as T;
  }

  set(state: object, path: string, value: unknown): void {
    const parts = path.split('.');

    if (parts.length === 0) {
      return;
    }
    // Refuse paths that would mutate the prototype chain (prototype pollution).
    for (const part of parts) {
      if (part === '' || FORBIDDEN_KEYS.has(part)) {
        return;
      }
    }
    // State-traversal boundary: `state` is typed as `object` at the interface
    // boundary; the cast widens it to an indexable record so the write loop
    // can traverse and create intermediate plain objects along the path.
    let current = state as Record<string, unknown>;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];

      if (part === undefined) {
        continue;
      }
      if (!(part in current)) {
        current[part] = {};
      }
      // State-traversal boundary: the intermediate segment at `part` is a
      // plain object created by this method (or supplied by the caller as
      // domain state). The cast to `Record<string, unknown>` advances the
      // traversal cursor; FORBIDDEN_KEYS guards prevent prototype pollution.
      current = current[part] as Record<string, unknown>;
    }
    const lastPart = parts[parts.length - 1];

    if (lastPart !== undefined) {
      current[lastPart] = value;
    }
  }
}
