/**
 * EmbeddedDAGNode: invoke a nested DAG with optional state mapping,
 * in JSON-LD canonical form.
 *
 * Uses `@type: 'EmbeddedDAGNode'` as the discriminator. `@id` is the placement
 * URN: `urn:noocodex:dag:<dagName>/node/<name>`. Cardinality is always 1;
 * exactly one child execution runs. To fork (one clone per source item),
 * use `ScatterNode` with `source`.
 *
 * `dag` (build-time literal) OR `dagFrom` (dotted state path resolved at
 * runtime) selects the sub-DAG to embed — exactly one of the two must be
 * present. `dag` is validated against the registered-DAG set at `registerDAG`
 * time. `dagFrom` is resolved via the state accessor at execution time; an
 * unregistered resolved name routes the placement to its `error` output
 * without throwing.
 *
 * `container` (optional): logical container role name. The dispatcher binds
 * role names to `DagContainerInterface` instances at construction via
 * `DagonizerOptionsType.containers`. A declared-but-unbound role throws a
 * `DAGError` at `registerDAG` time. When absent, the embedded DAG always runs
 * in-process.
 */

import type { FromSchema } from 'json-schema-to-ts';

import type { StateAccessorInterface } from '../../contracts/StateAccessorInterface.js';

export const EmbeddedDAGNodeSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/EmbeddedDAGNode',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['@id', '@type', 'name', 'outputs'],
  'properties': {
    '@id':   { 'type': 'string', 'minLength': 1 },
    '@type': { 'type': 'string', 'const': 'EmbeddedDAGNode' },
    'name':  { 'type': 'string', 'minLength': 1 },
    // Build-time literal dag name. Validated at registerDAG time.
    // Exactly one of `dag` | `dagFrom` must be present (enforced by DAGValidator).
    'dag':     { 'type': 'string', 'minLength': 1 },
    // Dotted state path whose resolved string value names the dag at runtime.
    // Unregistered resolved names route to the placement's `error` output (no throw).
    'dagFrom': { 'type': 'string', 'minLength': 1 },
    'outputs': {
      'type': 'object',
      'additionalProperties': { 'type': 'string' },
    },
    'stateMapping': {
      'type': 'object',
      'properties': {
        // input: seed the child before it runs (child-state key → parent-state dotted path).
        'input':  { 'type': 'object', 'additionalProperties': { 'type': 'string' }, 'description': 'child-state key -> parent-state dotted path; copied into the child before it runs' },
        // output: copy back after the child completes (parent-state dotted path → child-state key).
        'output': { 'type': 'object', 'additionalProperties': { 'type': 'string' }, 'description': 'parent-state dotted path -> child-state key; copied into the parent after the child completes' },
      },
      'additionalProperties': false,
    },
    // Logical container role. Bound at dispatcher construction via
    // DagonizerOptionsType.containers. Absent = always in-process.
    'container': { 'type': 'string', 'minLength': 1 },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `EmbeddedDAGNodeSchema` via `json-schema-to-ts`. */
export type EmbeddedDAGNodeType = FromSchema<typeof EmbeddedDAGNodeSchema>;

/** Empty state-mapping: the default when `stateMapping` is absent on an `EmbeddedDAGNode`. */
const EMBEDDED_EMPTY_MAPPING: Readonly<Record<string, string>> = Object.freeze({});

/**
 * Default-filling helpers for `EmbeddedDAGNode` fields that are optional in
 * the wire schema but must be present for engine-internal processing.
 *
 * Callers resolve once at entry and never optional-chain afterward.
 */
export class EmbeddedDAGNodeDefaults {
  private constructor() { /* static-only */ }

  /**
   * Return the `stateMapping.input` map, defaulting to an empty mapping when
   * `stateMapping` is absent.
   */
  static inputMapping(node: EmbeddedDAGNodeType): Readonly<Record<string, string>> {
    return node.stateMapping?.input ?? EMBEDDED_EMPTY_MAPPING;
  }

  /**
   * Return the `stateMapping.output` map, defaulting to an empty mapping when
   * `stateMapping` is absent.
   */
  static outputMapping(node: EmbeddedDAGNodeType): Readonly<Record<string, string>> {
    return node.stateMapping?.output ?? EMBEDDED_EMPTY_MAPPING;
  }

  /**
   * Resolve the dag name for an `EmbeddedDAGNode` placement.
   *
   * - `dag` present (build-time literal): returns `node.dag` directly.
   * - `dagFrom` present (runtime path): reads `accessor.get(state, node.dagFrom)`
   *   and coerces to string. Returns `null` when the path resolves to a non-string
   *   or absent value — the caller routes to `error` on `null`.
   *
   * Callers are responsible for checking the resolved name against the
   * registered-DAG set; this method performs only path resolution.
   */
  static resolveDagName(
    node: EmbeddedDAGNodeType,
    state: object,
    accessor: StateAccessorInterface,
  ): string | null {
    if (node.dag !== undefined) return node.dag;
    if (node.dagFrom !== undefined) {
      const resolved = accessor.get(state, node.dagFrom);
      return typeof resolved === 'string' && resolved.length > 0 ? resolved : null;
    }
    return null;
  }
}
