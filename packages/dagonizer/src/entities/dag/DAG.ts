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

import { EmbeddedDAGNodeSchema } from './EmbeddedDAGNode.js';
import { GatherNodeSchema } from './GatherNode.js';
import { PhaseNodeSchema } from './PhaseNode.js';
import { ScatterNodeSchema } from './ScatterNode.js';
import { SingleNodeSchema } from './SingleNode.js';
import { TerminalNodeSchema } from './TerminalNode.js';

// ---------------------------------------------------------------------------
// Namespace
// ---------------------------------------------------------------------------

const NS = 'https://noocodec.dev/ontology/dag/';

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
  'entrypoints': { '@id': `${NS}entrypoints`, '@container': '@index' },
  'nodes':       { '@id': `${NS}nodes`, '@container': '@set' },

  // ── placement-level properties ────────────────────────────────────────────
  'outputs':  { '@id': `${NS}outputs` },
  'node':     { '@id': `${NS}node` },
  'dag':      { '@id': `${NS}dag` },

  // scatter properties
  'body':        { '@id': `${NS}body` },
  'source':      { '@id': `${NS}source` },
  'sources': { '@id': `${NS}sources`, '@container': '@index' },
  'itemKey':     { '@id': `${NS}itemKey` },
  'execution':   { '@id': `${NS}execution` },
  'concurrency': { '@id': `${NS}concurrency` },
  'throttle':    { '@id': `${NS}throttle` },
  'reservoir':   { '@id': `${NS}reservoir` },
  'gather':      { '@id': `${NS}gather` },
  'dagReference': { '@id': `${NS}dagReference`, '@type': '@id' },
  'DagReference': { '@id': `${NS}DagReference` },
  'from':        { '@id': `${NS}from` },
  'path':        { '@id': `${NS}path` },
  'candidates':  { '@id': `${NS}candidates`, '@container': '@set' },
  'candidateDag': { '@id': `${NS}candidateDag`, '@type': '@id' },
  'selectedDag': { '@id': `${NS}selectedDag`, '@type': '@id' },
  'resultField': { '@id': `${NS}resultField` },
  'policy':      { '@id': `${NS}policy` },
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
  'GatherNode':      { '@id': `${NS}GatherNode` },
  'TerminalNode':    { '@id': `${NS}TerminalNode` },
  'PhaseNode':       { '@id': `${NS}PhaseNode` },
} as const;

// ---------------------------------------------------------------------------
// Node placement sub-schemas (inline, share structure with standalone schemas)
// ---------------------------------------------------------------------------

const DAGNodeEntrySchema = {
  'oneOf': [
    SingleNodeSchema,
    ScatterNodeSchema,
    EmbeddedDAGNodeSchema,
    GatherNodeSchema,
    TerminalNodeSchema,
    PhaseNodeSchema,
  ],
} as const;

export const DAGSchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer/DAG',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['@context', '@id', '@type', 'name', 'version', 'entrypoints', 'nodes'],
  'properties': {
    '@context': { 'type': 'object' },
    '@id':      { 'type': 'string', 'minLength': 1 },
    '@type':    { 'type': 'string', 'const': 'DAG' },
    'name':       { 'type': 'string', 'minLength': 1 },
    'version':    { 'type': 'string', 'minLength': 1 },
    'entrypoints': {
      'type': 'object',
      'minProperties': 1,
      'propertyNames': { 'minLength': 1 },
      'additionalProperties': { 'type': 'string', 'minLength': 1 },
    },
    'nodes': { 'type': 'array', 'items': DAGNodeEntrySchema, 'minItems': 1 },
  },
  'additionalProperties': false,
} as const;

/** TypeScript type derived from `DAGSchema` via `json-schema-to-ts`. */
export type DAGType = FromSchema<typeof DAGSchema>;

export class DAGEntrypoints {
  private constructor() { /* static-only */ }

  static primary(dag: DAGType): string {
    const main = dag.entrypoints['main'];
    if (main !== undefined) return main;
    for (const entrypoint of Object.values(dag.entrypoints)) {
      return entrypoint;
    }
    throw new Error(`DAG '${dag.name}' has no entrypoints`);
  }
}

/**
 * Identity helpers for DAG documents.
 *
 * `DAG` is both the wire-shape type (derived from `DAGSchema`) and this
 * frozen value namespace. TypeScript permits a `type` and a `const`
 * with the same identifier because they live in separate declaration spaces.
 *
 * `DAGIdentity.id` validates caller-supplied DAG IRIs. `DAGIdentity.placementId`
 * composes a placement IRI from an explicit DAG IRI and an explicit placement
 * identifier. Display names never participate in identity construction.
 */
export const DAGIdentity = Object.freeze({
  /**
   * Validate and return a canonical DAG IRI.
   */
  id(iri: string): string {
    if (iri.length === 0 || !(iri.startsWith('urn:') || iri.includes('://'))) {
      throw new Error(`DAGIdentity.id requires an absolute IRI`);
    }
    return iri;
  },

  /**
   * Compose a placement IRI from a DAG IRI and explicit placement identifier.
   */
  placementId(dagIri: string, placementId: string): string {
    if (placementId.length === 0) {
      throw new Error(`DAGIdentity.placementId requires a non-empty placement identifier`);
    }
    return `${DAGIdentity.id(dagIri)}/node/${placementId}`;
  },
});
