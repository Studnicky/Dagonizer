/**
 * DAG: top-level DAG declaration in JSON-LD 1.1 canonical form.
 *
 * A DAG document is JSON-LD natively. The `@context` field identifies the
 * ontology namespace; `@id` is the URN; `@type` is the RDF class. Node
 * placements use `@type` as the discriminator (replacing the flat `type` key).
 *
 * Inlines its node-entry sub-shapes via `oneOf` so a single validator covers
 * the whole document; the standalone `SingleNodeSchema` / `ScatterNodeSchema`
 * / `EmbeddedDAGNodeSchema` exports remain available for per-shape validation.
 */

import type { FromSchema } from 'json-schema-to-ts';

import { GatherConfigSchema } from './GatherConfig.js';

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
 *   DAG: top-level DAG document
 *   Placement: abstract superclass of all node placement shapes
 *   SingleNode: single-node placement (`@type: 'SingleNode'`)
 *   ScatterNode: scatter placement (`@type: 'ScatterNode'`): isolate a state
 *                clone, run a body (`{node}` or `{dag}`) per item, gather the
 *                produced clone state back into the parent, route on outcome.
 *
 * Properties follow the DAG schema field names exactly; no wire-level renames.
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

  // scatter properties
  'body':        { '@id': `${NS}body` },
  'source':      { '@id': `${NS}source` },
  'itemKey':     { '@id': `${NS}itemKey` },
  'execution':   { '@id': `${NS}execution` },
  'concurrency': { '@id': `${NS}concurrency` },
  'throttle':    { '@id': `${NS}throttle` },
  'reservoir':   { '@id': `${NS}reservoir` },
  'gather':      { '@id': `${NS}gather` },
  'reducer':     { '@id': `${NS}reducer` },

  // terminal properties
  'outcome': { '@id': `${NS}outcome` },

  // phase properties
  'phase': { '@id': `${NS}phase` },

  // embedded-dag properties
  'stateMapping': { '@id': `${NS}stateMapping` },

  // containment properties (EmbeddedDAGNode + ScatterNode dag-body only)
  'container': { '@id': `${NS}container` },

  // ── classes ───────────────────────────────────────────────────────────────
  'DAG':             { '@id': `${NS}DAG` },
  'Placement':       { '@id': `${NS}Placement` },
  'SingleNode':      { '@id': `${NS}SingleNode` },
  'ScatterNode':     { '@id': `${NS}ScatterNode` },
  'EmbeddedDAGNode': { '@id': `${NS}EmbeddedDAGNode` },
  'TerminalNode':    { '@id': `${NS}TerminalNode` },
  'PhaseNode':       { '@id': `${NS}PhaseNode` },
} as const;

// ---------------------------------------------------------------------------
// Node placement sub-schemas (inline, share structure with standalone schemas)
// ---------------------------------------------------------------------------

const DAGNodeEntrySchema = {
  'oneOf': [
    {
      'type': 'object',
      'required': ['@id', '@type', 'name', 'node', 'outputs'],
      'properties': {
        '@id':     { 'type': 'string', 'minLength': 1 },
        '@type':   { 'type': 'string', 'const': 'SingleNode' },
        'name':    { 'type': 'string', 'minLength': 1 },
        'node':    { 'type': 'string', 'minLength': 1 },
        'outputs': {
          'type': 'object',
          'additionalProperties': { 'type': 'string' },
        },
        'retry': {
          'type': 'object',
          'properties': {
            'maxAttempts':  { 'type': 'integer', 'minimum': 1 },
            'strategy':     { 'type': 'string', 'enum': ['constant', 'linear', 'exponential', 'decorrelated-jitter'] },
            'baseDelay':    { 'type': 'integer', 'minimum': 0 },
            'maxDelay':     { 'type': 'integer', 'minimum': 0 },
            'multiplier':   { 'type': 'number' },
            'jitterFactor': { 'type': 'number' },
            'on': {
              'type': 'array',
              'items': { 'type': 'string' },
            },
          },
        },
      },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['@id', '@type', 'name', 'body', 'source', 'gather', 'outputs'],
      'properties': {
        '@id':         { 'type': 'string', 'minLength': 1 },
        '@type':       { 'type': 'string', 'const': 'ScatterNode' },
        'name':        { 'type': 'string', 'minLength': 1 },
        'body': {
          'oneOf': [
            {
              'type': 'object',
              'required': ['node'],
              'properties': { 'node': { 'type': 'string', 'minLength': 1 } },
              'additionalProperties': false,
            },
            {
              'type': 'object',
              'required': ['dag'],
              'properties': { 'dag': { 'type': 'string', 'minLength': 1 } },
              'additionalProperties': false,
            },
            {
              'type': 'object',
              'required': ['dagFrom'],
              'properties': { 'dagFrom': { 'type': 'string', 'minLength': 1 } },
              'additionalProperties': false,
            },
          ],
        },
        'source':      { 'type': 'string', 'minLength': 1 },
        'itemKey':     { 'type': 'string', 'minLength': 1 },
        'stateMapping': {
          'type': 'object',
          'properties': {
            'input': { 'type': 'object', 'additionalProperties': { 'type': 'string' } },
          },
          'additionalProperties': false,
        },
        'gather':      GatherConfigSchema,
        'reducer':     { 'type': 'string', 'minLength': 1 },
        'outputs': {
          'type': 'object',
          'additionalProperties': { 'type': 'string' },
        },
        'container': { 'type': 'string', 'minLength': 1 },
        // Unified concurrency-limiting policy: ONE discriminated `mode` structure
        // instead of three uncoordinated sibling knobs. See ScatterNode.ts's doc
        // comment for the full `item` vs `reservoir` semantics.
        'execution': {
          'oneOf': [
            {
              'type': 'object',
              'required': ['mode'],
              'properties': {
                'mode': { 'type': 'string', 'const': 'item' },
                'concurrency': { 'type': 'integer', 'minimum': 1 },
                'throttle': {
                  'type': 'object',
                  'required': ['concurrencyLimit'],
                  'properties': {
                    'concurrencyLimit': { 'type': 'integer', 'minimum': 1 },
                  },
                  'additionalProperties': false,
                },
              },
              'additionalProperties': false,
            },
            {
              'type': 'object',
              'required': ['mode', 'reservoir'],
              'properties': {
                'mode': { 'type': 'string', 'const': 'reservoir' },
                'concurrency': { 'type': 'integer', 'minimum': 1 },
                'reservoir': {
                  'type': 'object',
                  'required': ['keyField', 'capacity'],
                  'properties': {
                    'keyField':  { 'type': 'string', 'minLength': 1 },
                    'capacity':  { 'type': 'integer', 'minimum': 1 },
                    'idleMs':    { 'type': 'integer', 'minimum': 1 },
                  },
                  'additionalProperties': false,
                },
              },
              'additionalProperties': false,
            },
          ],
        },
      },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      // Exactly one of `dag` | `dagFrom` is enforced by DAGValidator; the wire
      // schema allows either to be present (or, structurally, neither/both —
      // the semantic check rejects those).
      'required': ['@id', '@type', 'name', 'outputs'],
      'properties': {
        '@id':     { 'type': 'string', 'minLength': 1 },
        '@type':   { 'type': 'string', 'const': 'EmbeddedDAGNode' },
        'name':    { 'type': 'string', 'minLength': 1 },
        'dag':     { 'type': 'string', 'minLength': 1 },
        'dagFrom': { 'type': 'string', 'minLength': 1 },
        'outputs': {
          'type': 'object',
          'additionalProperties': { 'type': 'string' },
        },
        'stateMapping': {
          'type': 'object',
          'properties': {
            'input':  { 'type': 'object', 'additionalProperties': { 'type': 'string' } },
            'output': { 'type': 'object', 'additionalProperties': { 'type': 'string' } },
          },
          'additionalProperties': false,
        },
        'container': { 'type': 'string', 'minLength': 1 },
      },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['@id', '@type', 'name', 'outcome'],
      'properties': {
        '@id':     { 'type': 'string', 'minLength': 1 },
        '@type':   { 'type': 'string', 'const': 'TerminalNode' },
        'name':    { 'type': 'string', 'minLength': 1 },
        'outcome': { 'type': 'string', 'enum': ['completed', 'failed'] },
      },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['@id', '@type', 'name', 'node', 'phase'],
      'properties': {
        '@id':   { 'type': 'string', 'minLength': 1 },
        '@type': { 'type': 'string', 'const': 'PhaseNode' },
        'name':  { 'type': 'string', 'minLength': 1 },
        'node':  { 'type': 'string', 'minLength': 1 },
        'phase': { 'type': 'string', 'enum': ['pre', 'post'] },
      },
      'additionalProperties': false,
    },
  ],
} as const;

export const DAGSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/DAG',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['@context', '@id', '@type', 'name', 'version', 'entrypoint', 'nodes'],
  'properties': {
    '@context': { 'type': 'object' },
    '@id':      { 'type': 'string', 'minLength': 1 },
    '@type':    { 'type': 'string', 'const': 'DAG' },
    'name':       { 'type': 'string', 'minLength': 1 },
    'version':    { 'type': 'string', 'minLength': 1 },
    'entrypoint': { 'type': 'string', 'minLength': 1 },
    'nodes': { 'type': 'array', 'items': DAGNodeEntrySchema, 'minItems': 1 },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `DAGSchema` via `json-schema-to-ts`. */
export type DAGType = FromSchema<typeof DAGSchema>;

/**
 * Identity helpers for DAG documents.
 *
 * `DAG` is both the wire-shape type (derived from `DAGSchema`) and this
 * frozen value namespace. TypeScript permits a `type` alias and a `const`
 * with the same identifier because they live in separate declaration spaces.
 *
 * `DAGIdentity.id` and `DAGIdentity.placementId` produce the canonical URN
 * identifiers used in `@id` fields of JSON-LD DAG documents. The value carries a
 * distinct name from the `DAG` entity type so the two never share one identifier.
 */
export const DAGIdentity = Object.freeze({
  /**
   * Returns the canonical URN for a DAG by name.
   *
   * @param dagName - The DAG `name` field value.
   * @returns `urn:noocodex:dag:<dagName>`
   *
   * @example
   * ```ts
   * DAGIdentity.id('my-workflow'); // 'urn:noocodex:dag:my-workflow'
   * ```
   */
  id(dagName: string): string {
    return `urn:noocodex:dag:${dagName}`;
  },

  /**
   * Returns the canonical URN for a node placement within a DAG.
   *
   * @param dagName - The DAG `name` field value.
   * @param placementName - The placement `name` field value.
   * @returns `urn:noocodex:dag:<dagName>/node/<placementName>`
   *
   * @example
   * ```ts
   * DAGIdentity.placementId('my-workflow', 'fetchData'); // 'urn:noocodex:dag:my-workflow/node/fetchData'
   * ```
   */
  placementId(dagName: string, placementName: string): string {
    return `urn:noocodex:dag:${dagName}/node/${placementName}`;
  },
});
