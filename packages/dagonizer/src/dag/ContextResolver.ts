/**
 * ContextResolver: in-house prefix→IRI expansion for DAG and node names.
 *
 * Expands short names to absolute IRIs using a JSON-LD-inspired `@context`
 * prefix map. Two expansion rules apply:
 *
 *  - Bare name (no colon after position 0): `DEFAULT_NS + name`
 *  - Prefixed name (`prefix:local`): look up `prefix` in the context map,
 *    concatenate the namespace IRI with `local`
 *
 * Hot-path Maps stay `Map<string,…>` throughout the engine — an IRI is a
 * string — so there is zero per-dispatch overhead from graph work.
 */

import { DAGError } from '../errors/DAGError.js';

export class ContextResolver {
  private constructor() { /* static class */ }

  /** Default namespace for bare (un-prefixed) names. */
  static readonly DEFAULT_NS = 'https://noocodex.dev/dag/default#';

  /**
   * Expand a short name to an absolute IRI using the provided context prefix
   * map.
   *
   * Rules (applied in order):
   *  1. Bare name (no colon, or colon at position 0): `DEFAULT_NS + name`.
   *  2. Absolute IRI (`://` immediately follows the colon): return `name`
   *     as-is — prevents double-expansion of already-expanded IRIs.
   *  3. Prefixed name (`prefix:local`) where `prefix` IS a key in `context`:
   *     return `prefixNs + local`.
   *  4. Prefixed name where `prefix` is NOT in `context`: treat the entire
   *     name (colon included) as a bare name → `DEFAULT_NS + name`. This
   *     keeps existing compound names that use colons as separators (e.g.
   *     `tool-invoke:calculator`, `tool:calculator`) unique in the registry
   *     without requiring callers to declare them as prefixes.
   *
   * Does NOT throw — unknown prefixes fall through to rule 4.
   * Use `ContextResolver.validate` to detect prefix collisions in a context.
   */
  /**
   * Narrow an unknown value to a context prefix map (`Record<string, unknown>`)
   * via a type-guard predicate — no `as` casts. Arrays and `null` are excluded.
   */
  static isContext(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  /**
   * Resolve a DAG document's `@context` value to a prefix map. Returns an empty
   * map when the value is absent or not a plain object. Cast-free: narrows via
   * `ContextResolver.isContext`.
   */
  static contextOf(value: unknown): Record<string, unknown> {
    return ContextResolver.isContext(value) ? value : {};
  }

  static expand(name: string, context: Record<string, unknown>): string {
    const colonIdx = name.indexOf(':');
    if (colonIdx <= 0) {
      // Bare name (no colon, or colon at position 0 which is invalid/unusual).
      return ContextResolver.DEFAULT_NS + name;
    }
    // If the character immediately after the colon is '/', the name is an
    // absolute IRI (http://, https://, urn://, etc.) — return as-is with no
    // prefix lookup. This guards against double-expanding an IRI that was
    // already stored in a checkpoint or produced by a previous expand call.
    if (name.charAt(colonIdx + 1) === '/') {
      return name;
    }
    const prefix = name.substring(0, colonIdx);
    const local  = name.substring(colonIdx + 1);
    const ns = context[prefix];
    if (typeof ns !== 'string' || ns.length === 0) {
      // Prefix not found in context. The name may be an existing compound
      // name (e.g. `tool-invoke:calculator`, `tool:calculator`) that uses a
      // colon as a separator rather than as a JSON-LD prefix separator.
      // Fall back to bare-name expansion: DEFAULT_NS + full name (including
      // the colon). This keeps existing compound names unique in the registry
      // without requiring callers to declare them as prefixes.
      return ContextResolver.DEFAULT_NS + name;
    }
    return ns + local;
  }

  /**
   * Validate a context object for semantic correctness.
   *
   * Scans every non-JSON-LD key (keys that do not start with `@`) whose value
   * is a non-empty string. Throws `DAGError` if two distinct prefix keys map
   * to the same namespace IRI — ambiguous inverse lookups and collisions would
   * make expansion non-deterministic.
   */
  static validate(context: Record<string, unknown>): void {
    const seenNamespaces = new Map<string, string>();
    for (const [key, value] of Object.entries(context)) {
      if (key.startsWith('@')) continue;
      if (typeof value !== 'string' || value.length === 0) continue;
      const existingKey = seenNamespaces.get(value);
      if (existingKey !== undefined) {
        throw new DAGError(
          `@context collision: prefix '${existingKey}' and prefix '${key}' both map to namespace '${value}'`,
        );
      }
      seenNamespaces.set(value, key);
    }
  }

  /**
   * Extract prefix → namespace IRI mappings from a `@context` object.
   *
   * Returns a `Map<string, string>` of every non-JSON-LD key whose value is a
   * non-empty string. JSON-LD keyword keys (starting with `@`) and non-string
   * values are silently skipped.
   */
  static prefixes(context: Record<string, unknown>): Map<string, string> {
    const result = new Map<string, string>();
    for (const [key, value] of Object.entries(context)) {
      if (key.startsWith('@')) continue;
      if (typeof value !== 'string' || value.length === 0) continue;
      result.set(key, value);
    }
    return result;
  }
}
