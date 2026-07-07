/**
 * EmbeddedDAGNode: invoke a nested DAG with optional state mapping,
 * in JSON-LD canonical form.
 *
 * Uses `@type: 'EmbeddedDAGNode'` as the discriminator. `@id` is the placement
 * URN: `urn:noocodex:dag:<dagName>/node/<name>`. Cardinality is always 1;
 * exactly one child execution runs. To fork (one clone per source item),
 * use `ScatterNode` with `source`.
 *
 * `dag` selects the sub-DAG to embed. It may be a literal DAG name or a
 * `DagReference` that reads a state path and restricts runtime selection to a
 * declared candidate set. Every candidate is validated against the
 * registered-DAG set at `registerDAG` time. A missing or non-candidate runtime
 * value routes the placement to its `error` output without throwing.
 *
 * `container` (optional): logical container role name. The dispatcher binds
 * role names to `DagContainerInterface` instances at construction via
 * `DagonizerOptionsType.containers`. A declared-but-unbound role throws a
 * `DAGError` at `registerDAG` time. When absent, the embedded DAG always runs
 * in-process.
 */

import type { FromSchema } from 'json-schema-to-ts';

import type { StateAccessorInterface } from '../../contracts/StateAccessorInterface.js';

import { DagReferenceShapeSchema } from './DagReference.js';

export const EmbeddedDAGNodeSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/EmbeddedDAGNode',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['@id', '@type', 'name', 'outputs'],
  'properties': {
    '@id':   { 'type': 'string', 'minLength': 1 },
    '@type': { 'type': 'string', 'const': 'EmbeddedDAGNode' },
    'name':  { 'type': 'string', 'minLength': 1 },
    'dag': DagReferenceShapeSchema,
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
    'gatherResult': {
      'type': 'object',
      'required': ['resultField'],
      'properties': {
        'resultField': { 'type': 'string', 'minLength': 1 },
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
   * - literal `dag`: returns the literal DAG name directly.
   * - dynamic `DagReference`: reads `reference.path` from state and returns the
   *   value only when it is one of `reference.candidates`. Returns `null` when
   *   the path resolves to a non-string, absent value, or non-candidate name.
   *
   * Callers are responsible for checking the resolved name against the
   * registered-DAG set; this method performs only path and candidate resolution.
   */
  static resolveDagName(
    node: EmbeddedDAGNodeType,
    state: object,
    accessor: StateAccessorInterface,
  ): string | null {
    const reference = node.dag;
    if (reference === undefined) return null;
    if (typeof reference === 'string') return reference;

    const resolved = accessor.get(state, reference.path);
    if (typeof resolved !== 'string' || resolved.length === 0) return null;
    return reference.candidates.includes(resolved) ? resolved : null;
  }
}
