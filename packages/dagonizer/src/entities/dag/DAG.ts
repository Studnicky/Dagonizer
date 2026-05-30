/**
 * DAG — top-level DAG declaration in JSON-LD 1.1 canonical form.
 *
 * A DAG document is JSON-LD natively. The `@context` field identifies the
 * ontology namespace; `@id` is the URN; `@type` is the RDF class. Node
 * placements use `@type` as the discriminator (replacing the flat `type` key).
 *
 * Inlines its node-entry sub-shapes via `oneOf` so a single validator covers
 * the whole document; the standalone `SingleNodeSchema` / `ParallelNodeSchema`
 * / `ScatterNodeSchema` / `EmbeddedDAGNodeSchema` exports remain available for
 * per-shape validation.
 *
 * Key mapping strategy — type-scoped contexts (JSON-LD 1.1):
 *   The JSON key `nodes` appears at two levels with different meanings:
 *     - DAG root: array of placement objects → IRI `dag/nodes`
 *     - ParallelNode: array of child node name strings → IRI `dag/parallelNodes`
 *   A JSON-LD 1.1 type-scoped context nested under the `ParallelNode` class
 *   overrides `nodes` to map to `dag/parallelNodes` within ParallelNode objects.
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
 *   DAG           — top-level DAG document
 *   Placement     — abstract superclass of all node placement shapes
 *   SingleNode    — single-node placement (`@type: 'SingleNode'`)
 *   ParallelNode  — concurrent-node placement (`@type: 'ParallelNode'`); carries
 *                   a nested type-scoped `@context` that remaps the `nodes`
 *                   key to `dag/parallelNodes` within ParallelNode objects.
 *   ScatterNode   — scatter placement (`@type: 'ScatterNode'`): isolate a state
 *                   clone, run a body (`{node}` or `{dag}`) per item, gather the
 *                   produced clone state back into the parent, route on outcome.
 *
 * Properties follow the DAG schema field names exactly — no wire-level renames.
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

  // scatter properties
  'body':        { '@id': `${NS}body` },
  'source':      { '@id': `${NS}source` },
  'itemKey':     { '@id': `${NS}itemKey` },
  'concurrency': { '@id': `${NS}concurrency` },
  'gather':      { '@id': `${NS}gather` },
  'reducer':     { '@id': `${NS}reducer` },

  // terminal properties
  'outcome': { '@id': `${NS}outcome` },

  // phase properties
  'phase': { '@id': `${NS}phase` },

  // embedded-dag properties
  'stateMapping': { '@id': `${NS}stateMapping` },

  // ── classes ───────────────────────────────────────────────────────────────
  'DAG':             { '@id': `${NS}DAG` },
  'Placement':       { '@id': `${NS}Placement` },
  'SingleNode':      { '@id': `${NS}SingleNode` },
  'ScatterNode':     { '@id': `${NS}ScatterNode` },
  'EmbeddedDAGNode': { '@id': `${NS}EmbeddedDAGNode` },
  'TerminalNode':    { '@id': `${NS}TerminalNode` },
  'PhaseNode':       { '@id': `${NS}PhaseNode` },

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
          'additionalProperties': { 'type': ['string', 'null'] },
        },
      },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['@id', '@type', 'name', 'nodes', 'combine', 'outputs'],
      'properties': {
        '@id':     { 'type': 'string', 'minLength': 1 },
        '@type':   { 'type': 'string', 'const': 'ParallelNode' },
        'name':    { 'type': 'string', 'minLength': 1 },
        'nodes':   { 'type': 'array', 'items': { 'type': 'string', 'minLength': 1 }, 'minItems': 1 },
        'combine': { 'type': 'string', 'enum': ['all-success', 'any-success', 'collect'] },
        'outputs': {
          'type': 'object',
          'additionalProperties': { 'type': ['string', 'null'] },
        },
      },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['@id', '@type', 'name', 'body', 'source', 'outputs'],
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
          ],
        },
        'source':      { 'type': 'string', 'minLength': 1 },
        'itemKey':     { 'type': 'string', 'minLength': 1 },
        'concurrency': { 'type': 'integer', 'minimum': 1 },
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
          'additionalProperties': { 'type': ['string', 'null'] },
        },
      },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['@id', '@type', 'name', 'dag', 'outputs'],
      'properties': {
        '@id':   { 'type': 'string', 'minLength': 1 },
        '@type': { 'type': 'string', 'const': 'EmbeddedDAGNode' },
        'name':  { 'type': 'string', 'minLength': 1 },
        'dag':   { 'type': 'string', 'minLength': 1 },
        'outputs': {
          'type': 'object',
          'additionalProperties': { 'type': ['string', 'null'] },
        },
        'stateMapping': {
          'type': 'object',
          'properties': {
            'input':  { 'type': 'object', 'additionalProperties': { 'type': 'string' } },
            'output': { 'type': 'object', 'additionalProperties': { 'type': 'string' } },
          },
          'additionalProperties': false,
        },
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
    '@context': {},
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
export type DAG = FromSchema<typeof DAGSchema>;
