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
    const target = DottedPathAccessor.#resolve(state, path);
    if (target !== null) {
      target.container[target.key] = value;
    }
  }

  append(state: object, path: string, value: unknown): void {
    const target = DottedPathAccessor.#resolve(state, path);
    if (target === null) {
      return;
    }
    const existing = target.container[target.key];
    if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      target.container[target.key] = [value];
    }
  }

  /**
   * Auto-vivifying traversal to the container object holding the final path
   * segment. Creates intermediate objects, refuses empty or prototype-walking
   * segments (returning null), and refuses to write through a non-object
   * intermediate. Shared by `set` and `append`.
   */
  static #resolve(state: object, path: string): { container: Record<string, unknown>; key: string } | null {
    const parts = path.split('.');
    if (parts.length === 0 || !DottedPathAccessor.isRecord(state)) {
      return null;
    }
    let current: Record<string, unknown> = state;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (part === undefined || part === '' || !DottedPathAccessor.isSafeProperty(part)) {
        return null;
      }
      if (!(part in current)) {
        current[part] = {};
      }
      const next = current[part];
      if (!DottedPathAccessor.isRecord(next)) {
        return null;
      }
      current = next;
    }
    const lastPart = parts[parts.length - 1];
    if (lastPart === undefined || lastPart === '' || !DottedPathAccessor.isSafeProperty(lastPart)) {
      return null;
    }
    return { 'container': current, 'key': lastPart };
  }
}
