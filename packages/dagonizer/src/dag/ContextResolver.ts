/**
 * ContextResolver: in-house prefix→IRI expansion and IRI→CURIE compaction.
 *
 * Expands CURIEs to absolute IRIs using a JSON-LD-inspired `@context` prefix
 * map. Two expansion rules apply:
 *
 *  - Absolute IRI (`urn:` or containing `://`): returned as-is
 *  - Prefixed name (`prefix:local`): look up `prefix` in the context map,
 *    concatenate the namespace IRI with `local`
 *
 * Hot-path Maps stay `Map<string,…>` throughout the engine — an IRI is a
 * string — so there is zero per-dispatch overhead from graph work.
 */

import { Predicates } from '@studnicky/predicates';

import { DAGError } from '../errors/DAGError.js';

export class ContextResolver {
  private constructor() { /* static class */ }

  private static readonly DAGONIZER_URN_NS = 'urn:noocodec:dag:';

  /**
   * Expand an absolute IRI or declared CURIE to a canonical IRI.
   *
   * Rules (applied in order):
   *  1. Absolute IRI (`://` immediately follows the colon, or `urn:`): return `name`
   *     as-is — prevents double-expansion of already-expanded IRIs.
   *  2. Prefixed name (`prefix:local`) where `prefix` IS a key in `context`:
   *     return `prefixNs + local`.
   *
   * Bare names and unknown prefixes throw. The engine never invents a runtime
   * IRI from display text.
   */
  /**
   * Narrow an unknown value to a context prefix map (`Record<string, unknown>`)
   * via a type-guard predicate — no `as` casts. Arrays and `null` are excluded.
   */
  static isContext(value: unknown): value is Record<string, unknown> {
    return Predicates.matchesType('object', value);
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
      throw new DAGError(`IRI reference '${name}' must be an absolute IRI or declared CURIE`, { 'code': 'CONFIGURATION_ERROR' });
    }
    // Absolute IRIs are already canonical runtime identities. Return as-is
    // with no prefix lookup to avoid double-expanding stored checkpoint IRIs.
    if (name.charAt(colonIdx + 1) === '/' || name.startsWith('urn:')) {
      return name;
    }
    const prefix = name.substring(0, colonIdx);
    const local  = name.substring(colonIdx + 1);
    const ns = context[prefix];
    if (typeof ns !== 'string' || ns.length === 0) {
      throw new DAGError(`IRI reference '${name}' uses undeclared prefix '${prefix}'`, { 'code': 'CONFIGURATION_ERROR' });
    }
    return ns + local;
  }

  /**
   * Compact an absolute IRI to a CURIE for presentation.
   *
   * Runtime identity stays the absolute IRI. This inverse lookup exists for
   * labels, logs, and diagrams where a placement may not provide a display
   * name. The longest namespace match wins so nested prefixes remain stable.
   */
  static compact(iri: string, context: Record<string, unknown>): string {
    let bestPrefix: string | null = null;
    let bestNamespace = '';
    for (const [prefix, namespaceIri] of ContextResolver.prefixes(context)) {
      if (!iri.startsWith(namespaceIri)) continue;
      if (namespaceIri.length <= bestNamespace.length) continue;
      bestPrefix = prefix;
      bestNamespace = namespaceIri;
    }
    if (bestPrefix !== null) return `${bestPrefix}:${iri.substring(bestNamespace.length)}`;
    if (iri.startsWith(ContextResolver.DAGONIZER_URN_NS)) {
      return `dag:${iri.substring(ContextResolver.DAGONIZER_URN_NS.length)}`;
    }
    return iri;
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
