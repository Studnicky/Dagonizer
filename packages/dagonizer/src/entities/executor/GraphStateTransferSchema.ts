/**
 * GraphStateTransfer: graph snapshot envelope shapes for persistence and
 * export surfaces that still move RDF/N-Quads directly.
 *
 * Container `ExecutionRequest`/`ExecutionResponse` no longer use this schema
 * for transient worker state. They use `TransientNodeStateBatchSchema` so
 * per-clone dispatch stays in plain JSON and avoids RDF projection on the hot
 * path.
 *
 * The envelope types remain for graph snapshot export, references, and shared
 * graph access where N-Quads transport is still the right representation.
 *
 *   - `inline-nquads`        one combined N-Quads document; one encode + one hash.
 *   - `graph-ref`            one store reference to the whole batch's combined graph.
 *   - `shared-endpoint`      one lease over every item graph; one combined write.
 *   - `inline-delta-nquads`  one combined additions/deletions N-Quads batch delta.
 *   - `delta-ref`            one store-referenced combined batch delta.
 *
 * Store-backed modes (`graph-ref`, `shared-endpoint`, `delta-ref`) are reachable
 * only when a `GraphStateTransferStore` is injected; the default browser/demo
 * path is `inline-nquads`. `byteSize`/`quadCount` measure the combined payload;
 * a single `hash` (where present) covers the whole batch.
 *
 * JSON Schema 2020-12 entity: schema value + FromSchema-derived TypeScript type.
 */

import type { FromSchema } from 'json-schema-to-ts';

/**
 * JSON Schema for the optional Node.js JSON-LD document view of a graph-state
 * payload. Reused by transfer metadata persistence paths.
 */
export const GraphStateJsonLdSchema = { 'type': 'object', 'required': ['@context', '@graph'], 'additionalProperties': true } as const;

/** JSON Schema for the combined per-batch inline N-Quads graph-state payload. */
export const GraphStateInlineSchema = {
  'type': 'object',
  'required': ['transport', 'format', 'nquads', 'graphIris', 'hash', 'byteSize', 'quadCount'],
  'properties': {
    'transport': { 'type': 'string', 'const': 'inline-nquads' },
    'format':    { 'type': 'string', 'const': 'application/n-quads' },
    'nquads':    { 'type': 'string' },
    'graphIris': { 'type': 'array', 'items': { 'type': 'string', 'minLength': 1 } },
    'hash':      { 'type': 'string', 'minLength': 1 },
    'byteSize':  { 'type': 'number', 'minimum': 0 },
    'quadCount': { 'type': 'integer', 'minimum': 0 },
  },
  'additionalProperties': false,
} as const;

const GraphStateReferenceSchema = {
  'type': 'object',
  'required': ['transport', 'format', 'graphIris', 'graphSnapshotRef', 'hash', 'byteSize', 'quadCount'],
  'properties': {
    'transport':        { 'type': 'string', 'const': 'graph-ref' },
    'format':           { 'type': 'string', 'const': 'application/n-quads' },
    'graphIris':        { 'type': 'array', 'items': { 'type': 'string', 'minLength': 1 } },
    'graphSnapshotRef': { 'type': 'string', 'minLength': 1 },
    'hash':             { 'type': 'string', 'minLength': 1 },
    'byteSize':         { 'type': 'number', 'minimum': 0 },
    'quadCount':        { 'type': 'integer', 'minimum': 0 },
  },
  'additionalProperties': false,
} as const;

const GraphStateSharedSchema = {
  'type': 'object',
  'required': ['transport', 'graphIris', 'endpoint', 'lease', 'byteSize', 'quadCount'],
  'properties': {
    'transport': { 'type': 'string', 'const': 'shared-endpoint' },
    'graphIris': { 'type': 'array', 'items': { 'type': 'string', 'minLength': 1 } },
    'endpoint':  { 'type': 'string', 'minLength': 1 },
    'lease':     { 'type': 'string', 'minLength': 1 },
    'byteSize':  { 'type': 'number', 'minimum': 0 },
    'quadCount': { 'type': 'integer', 'minimum': 0 },
  },
  'additionalProperties': false,
} as const;

const GraphStateInlineDeltaSchema = {
  'type': 'object',
  'required': ['transport', 'graphIris', 'baseSnapshotRef', 'additions', 'deletions', 'hash', 'byteSize', 'quadCount'],
  'properties': {
    'transport':       { 'type': 'string', 'const': 'inline-delta-nquads' },
    'graphIris':       { 'type': 'array', 'items': { 'type': 'string', 'minLength': 1 } },
    'baseSnapshotRef': { 'type': 'string', 'minLength': 1 },
    'additions':       { 'type': 'string' },
    'deletions':       { 'type': 'string' },
    'hash':            { 'type': 'string', 'minLength': 1 },
    'byteSize':        { 'type': 'number', 'minimum': 0 },
    'quadCount':       { 'type': 'integer', 'minimum': 0 },
  },
  'additionalProperties': false,
} as const;

const GraphStateDeltaReferenceSchema = {
  'type': 'object',
  'required': ['transport', 'graphIris', 'baseSnapshotRef', 'additions', 'deletions', 'hash', 'byteSize', 'quadCount'],
  'properties': {
    'transport':       { 'type': 'string', 'const': 'delta-ref' },
    'graphIris':       { 'type': 'array', 'items': { 'type': 'string', 'minLength': 1 } },
    'baseSnapshotRef': { 'type': 'string', 'minLength': 1 },
    'additions':       { 'type': 'string' },
    'deletions':       { 'type': 'string' },
    'hash':            { 'type': 'string', 'minLength': 1 },
    'byteSize':        { 'type': 'number', 'minimum': 0 },
    'quadCount':       { 'type': 'integer', 'minimum': 0 },
  },
  'additionalProperties': false,
} as const;

/** JSON Schema for the graph snapshot transfer union. */
export const GraphStateTransferSchema = {
  'oneOf': [GraphStateInlineSchema, GraphStateReferenceSchema, GraphStateSharedSchema, GraphStateInlineDeltaSchema, GraphStateDeltaReferenceSchema],
} as const;

/** TypeScript type derived from `GraphStateInlineSchema` — the inline arm of `GraphStateTransfer`. */
export type GraphStateInlineType = FromSchema<typeof GraphStateInlineSchema>;
/** Combined store-reference batch transfer (`graph-ref`). */
export type GraphStateReferenceType = FromSchema<typeof GraphStateReferenceSchema>;
/** Combined shared-endpoint batch transfer (`shared-endpoint`). */
export type GraphStateSharedType = FromSchema<typeof GraphStateSharedSchema>;
/** Combined inline delta batch transfer (`inline-delta-nquads`). */
export type GraphStateInlineDeltaType = FromSchema<typeof GraphStateInlineDeltaSchema>;
/** Combined store-referenced delta batch transfer (`delta-ref`). */
export type GraphStateDeltaReferenceType = FromSchema<typeof GraphStateDeltaReferenceSchema>;

/** Graph snapshot transfer payload, mode-aware. */
export type GraphStateTransferType =
  | GraphStateInlineType
  | GraphStateReferenceType
  | GraphStateSharedType
  | GraphStateInlineDeltaType
  | GraphStateDeltaReferenceType;
