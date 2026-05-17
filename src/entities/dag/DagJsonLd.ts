/**
 * DagJsonLd — JSON-LD serialisation helpers for `DAG`.
 *
 * The DAG wire shape is itself a small ontology. This module declares:
 *
 *   DAG_CONTEXT  — the canonical `@context` object, mapping every
 *                  class and property to the noocodex dag namespace.
 *
 *   toJsonLd     — adds `@context` + `@type` annotations to an existing
 *                  DAG value so the result is valid JSON-LD *and* still
 *                  consumable by `Dagonizer.load(json)`.
 *
 *   fromJsonLd   — strips `@context` / `@type` / `@id` annotations and
 *                  returns the canonical `DAG` interface shape.
 *
 * Round-trip identity guarantee:
 *   fromJsonLd(toJsonLd(dag)) deep-equals dag
 *
 * No new runtime dependencies — only the `DAG` type already in scope.
 *
 * Key mapping strategy — type-scoped contexts (JSON-LD 1.1):
 *   The JSON key `nodes` appears at two levels with different meanings:
 *     - DAG root: array of placement objects → IRI `dag/nodes`
 *     - ParallelNode: array of child node name strings → IRI `dag/parallelNodes`
 *   Rather than renaming one key on the wire, we use a JSON-LD 1.1
 *   type-scoped context nested under the `ParallelNode` class definition.
 *   When a JSON-LD processor encounters an object typed as `ParallelNode`,
 *   it applies the nested `@context`, which overrides `nodes` to map to
 *   `dag/parallelNodes`. The wire shape stays canonical (`nodes` everywhere).
 */

import type { DAG } from './DAG.js';

// ---------------------------------------------------------------------------
// Namespace
// ---------------------------------------------------------------------------

const NS = 'https://noocodex.dev/ontology/dag/';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/**
 * Canonical `@context` for DAG JSON-LD documents (JSON-LD 1.1).
 *
 * Classes:
 *   Placement     — abstract superclass of all node placement shapes
 *   SingleNode    — single-node placement (type: 'single')
 *   ParallelNode  — concurrent-node placement (type: 'parallel'); carries
 *                   a nested type-scoped `@context` that remaps the `nodes`
 *                   key to `dag/parallelNodes` within ParallelNode objects.
 *   FanOutNode    — fan-out placement (type: 'fan-out')
 *   SubDAGNode    — nested-DAG placement (type: 'sub-dag')
 *
 * Properties follow the DAG schema field names exactly — no wire-level
 * renames. The `nodes` key is used canonically at both levels; the
 * type-scoped context resolves the IRI difference transparently.
 */
export const DAG_CONTEXT: Record<string, unknown> = {
  '@version': 1.1,

  // ── DAG-level properties ──────────────────────────────────────────────────
  'name':       { '@id': `${NS}name` },
  'version':    { '@id': `${NS}version` },
  'entrypoint': { '@id': `${NS}entrypoint` },
  'nodes':      { '@id': `${NS}nodes`, '@container': '@set' },

  // ── placement-level properties ────────────────────────────────────────────
  'outputs':  { '@id': `${NS}outputs` },
  'node':     { '@id': `${NS}node` },
  'dag':      { '@id': `${NS}dag` },
  'combine':  { '@id': `${NS}combine` },

  // fan-out properties
  'source':      { '@id': `${NS}source` },
  'itemKey':     { '@id': `${NS}itemKey` },
  'concurrency': { '@id': `${NS}concurrency` },
  'fanIn':       { '@id': `${NS}fanIn` },

  // sub-dag properties
  'stateMapping': { '@id': `${NS}stateMapping` },

  // ── classes ───────────────────────────────────────────────────────────────
  'Placement':  { '@id': `${NS}Placement` },
  'SingleNode': { '@id': `${NS}SingleNode` },
  'FanOutNode': { '@id': `${NS}FanOutNode` },
  'SubDAGNode': { '@id': `${NS}SubDAGNode` },

  // ParallelNode carries a type-scoped context: within any object typed
  // ParallelNode, `nodes` maps to `dag/parallelNodes` (child name strings)
  // rather than the root-level `dag/nodes` (placement objects).
  'ParallelNode': {
    '@id': `${NS}ParallelNode`,
    '@context': {
      'nodes': {
        '@id':        `${NS}parallelNodes`,
        '@container': '@list',
      },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Type → JSON-LD @type mapping
// ---------------------------------------------------------------------------

/**
 * Maps the DAG `type` discriminant to the JSON-LD compact type term.
 * Compact terms (not full IRIs) are used so that type-scoped contexts
 * defined in `DAG_CONTEXT` are activated by JSON-LD 1.1 processors.
 */
const TYPE_MAP: Readonly<Record<string, string>> = {
  'single':   'SingleNode',
  'parallel': 'ParallelNode',
  'fan-out':  'FanOutNode',
  'sub-dag':  'SubDAGNode',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Keys that are JSON-LD meta-annotations, not DAG payload. */
const JSONLD_KEYS = new Set(['@context', '@type', '@id']);

/** Strip any `@`-prefixed keys from an object recursively. */
function stripAnnotations(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripAnnotations);
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!JSONLD_KEYS.has(k)) {
        result[k] = stripAnnotations(v);
      }
    }
    return result;
  }
  return value;
}

/** Add `@type` to a node entry object. */
function annotateNode(entry: Record<string, unknown>): Record<string, unknown> {
  const typeLiteral = typeof entry['type'] === 'string' ? entry['type'] : '';
  const jsonldType = TYPE_MAP[typeLiteral];
  return jsonldType !== undefined
    ? { '@type': jsonldType, ...entry }
    : { ...entry };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Serialise a `DAG` to a JSON-LD document.
 *
 * The returned object is:
 *  - valid JSON-LD: `@context` at root, `@type` on every node entry.
 *  - structurally identical to the input `DAG` (no field renames) so
 *    `Dagonizer.load(toJsonLd(dag))` works without stripping annotations
 *    (Ajv ignores unknown keys by default).
 *
 * @example
 * ```ts
 * import { toJsonLd } from '@noocodex/dagonizer/entities';
 *
 * const jsonld = toJsonLd(myDag);
 * fs.writeFileSync('dag.jsonld', JSON.stringify(jsonld, null, 2));
 * ```
 */
export function toJsonLd(dag: DAG): Record<string, unknown> {
  const nodes = (dag.nodes as readonly Record<string, unknown>[]).map(annotateNode);
  return {
    '@context': DAG_CONTEXT,
    '@type': `${NS}DAG`,
    'name': dag.name,
    'version': dag.version,
    'entrypoint': dag.entrypoint,
    'nodes': nodes,
  };
}

/**
 * Deserialise a JSON-LD document back to a canonical `DAG`.
 *
 * Strips all `@context`, `@type`, and `@id` annotations (recursively)
 * so the result satisfies `DAGSchema` exactly and is safe to pass to
 * `Dagonizer.load()`.
 *
 * Round-trip identity:
 * ```ts
 * import { toJsonLd, fromJsonLd } from '@noocodex/dagonizer/entities';
 * assert.deepStrictEqual(fromJsonLd(toJsonLd(dag)), dag);
 * ```
 */
export function fromJsonLd(jsonld: Record<string, unknown>): DAG {
  return stripAnnotations(jsonld) as DAG;
}
