/**
 * BridgeMessage: variant-discriminated protocol message for the parent ↔ DagHost channel.
 *
 * One oneOf schema with inline branches (DAG.ts DAGNodeEntrySchema style).
 * Every branch uses `additionalProperties: false`; every field is required
 * per branch so producers never emit absent fields.
 *
 * The `execute` branch carries a dag-only request: no `variant` discriminant
 * on the request, no `nodeName`. A DagHost runs only whole DAGs.
 * The `result` branch carries a dag-only response using per-item `items`
 * (not a top-level `terminalOutput`). The inline shapes are structural copies
 * of the canonical ExecutionRequest / ExecutionResponse schemas to avoid
 * $ref resolution at compile time.
 *
 * Parent → host: init, execute, abort, shutdown
 * Host → parent: ready, result, intermediate, instrumentation, error, log
 *
 * JSON Schema 2020-12 entity: schema value + FromSchema-derived TypeScript type.
 */

import type { FromSchema } from 'json-schema-to-ts';

import { NodeErrorProperties, NodeErrorSchema } from '../node/NodeError.js';

// ---------------------------------------------------------------------------
// Inline shape copies
// ---------------------------------------------------------------------------

const InlineNodeErrorShape = {
  'type': 'object',
  'required': NodeErrorSchema.required,
  'properties': NodeErrorProperties,
  'additionalProperties': false,
} as const;

/**
 * Inline copy of the dag-only ExecutionRequest shape.
 * See ExecutionRequest.ts for the canonical schema.
 * No `variant` discriminant; no `nodeName`. DagHost runs only whole DAGs.
 * `items` carries one or more `{ id, snapshot }` pairs for batch execution.
 */
const InlineExecutionRequestShape = {
  'type': 'object',
  'required': ['dagName', 'placementPath', 'items', 'timeoutMs', 'correlationId'],
  'properties': {
    'dagName':       { 'type': 'string', 'minLength': 1 },
    'placementPath': { 'type': 'array', 'items': { 'type': 'string' } },
    'items': {
      'type': 'array',
      'minItems': 1,
      'items': {
        'type': 'object',
        'required': ['id', 'snapshot'],
        'properties': {
          'id':       { 'type': 'string', 'minLength': 1 },
          'snapshot': { 'type': 'object' },
        },
        'additionalProperties': false,
      },
    },
    'timeoutMs':     { 'type': ['number', 'null'] },
    'correlationId': { 'type': 'string', 'minLength': 1 },
  },
  'additionalProperties': false,
} as const;

/**
 * Inline copy of the dag-only ExecutionResponse shape.
 * See ExecutionResponse.ts for the canonical schema.
 * Per-item results live in `items[*].{ id, snapshot, terminalOutcome }`.
 * The ExecutorIntermediate items shape (output, skipped, nodeName) is an
 * inline copy of ExecutorIntermediate.ts — intentionally duplicated to
 * avoid $ref resolution at compile time.
 */
const InlineExecutionResponseShape = {
  'type': 'object',
  'required': ['correlationId', 'items', 'errors', 'intermediates'],
  'properties': {
    'correlationId': { 'type': 'string', 'minLength': 1 },
    'items': {
      'type': 'array',
      'minItems': 1,
      'items': {
        'type': 'object',
        'required': ['id', 'snapshot', 'terminalOutcome'],
        'properties': {
          'id':              { 'type': 'string', 'minLength': 1 },
          'snapshot':        { 'type': ['object', 'null'] },
          'terminalOutcome': { 'type': 'string' },
        },
        'additionalProperties': false,
      },
    },
    'errors': {
      'type': 'array',
      'items': InlineNodeErrorShape,
    },
    'intermediates': {
      'type': 'array',
      'items': {
        'type': 'object',
        'required': ['output', 'skipped', 'nodeName'],
        'properties': {
          'output':   { 'type': ['string', 'null'] },
          'skipped':  { 'type': 'boolean' },
          'nodeName': { 'type': 'string' },
        },
        'additionalProperties': false,
      },
    },
  },
  'additionalProperties': false,
} as const;

// ---------------------------------------------------------------------------
// BridgeMessage schema
// ---------------------------------------------------------------------------

export const BridgeMessageSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/BridgeMessage',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'oneOf': [
    // ── parent → host ────────────────────────────────────────────────────────
    {
      'type': 'object',
      'required': ['variant', 'registryModule', 'registryVersion', 'servicesConfig'],
      'properties': {
        'variant':         { 'type': 'string', 'const': 'init' },
        'registryModule':  { 'type': 'string', 'minLength': 1 },
        'registryVersion': { 'type': 'string', 'minLength': 1 },
        'servicesConfig':  { 'type': 'object' },
        /**
         * Optional keying scheme for the registry maps in the isolate bundle.
         * When absent, defaults to `'name'` (bare-name keying, backward compatible).
         * When `'iri'`, the bundle's nodes and DAGs are keyed by expanded IRI.
         * The host validates that parent and bundle agree; mismatches produce
         * a `VERSION_MISMATCH` error response.
         */
        'keyingScheme': { 'type': 'string', 'enum': ['name', 'iri'] },
      },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['variant', 'request'],
      'properties': {
        'variant': { 'type': 'string', 'const': 'execute' },
        'request': InlineExecutionRequestShape,
      },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['variant', 'correlationId', 'reason'],
      'properties': {
        'variant':       { 'type': 'string', 'const': 'abort' },
        'correlationId': { 'type': 'string' },
        // R2: 'abort' = caller-initiated cancel; 'timeout' = run-level deadline expired.
        'reason':        { 'type': 'string', 'enum': ['abort', 'timeout'] },
      },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['variant'],
      'properties': {
        'variant': { 'type': 'string', 'const': 'shutdown' },
      },
      'additionalProperties': false,
    },
    // ── host → parent ────────────────────────────────────────────────────────
    {
      'type': 'object',
      'required': ['variant', 'registryVersion', 'capabilities'],
      'properties': {
        'variant':         { 'type': 'string', 'const': 'ready' },
        'registryVersion': { 'type': 'string', 'minLength': 1 },
        'capabilities':    { 'type': 'array', 'items': { 'type': 'string' } },
      },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['variant', 'response'],
      'properties': {
        'variant':  { 'type': 'string', 'const': 'result' },
        'response': InlineExecutionResponseShape,
      },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['variant', 'correlationId', 'nodeName', 'output', 'placementPath'],
      'properties': {
        'variant':       { 'type': 'string', 'const': 'intermediate' },
        'correlationId': { 'type': 'string' },
        'nodeName':      { 'type': 'string' },
        'output':        { 'type': ['string', 'null'] },
        'placementPath': { 'type': 'array', 'items': { 'type': 'string' } },
      },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['variant', 'correlationId', 'hook', 'phase', 'dagName', 'nodeName', 'output', 'message', 'placementPath'],
      'properties': {
        'variant':       { 'type': 'string', 'const': 'instrumentation' },
        'correlationId': { 'type': 'string' },
        'hook':          { 'type': 'string', 'enum': ['nodeStart', 'nodeEnd', 'phaseEnter', 'phaseExit', 'error'] },
        // 'pre'/'post' for phaseEnter/phaseExit; '' for every other hook.
        'phase':         { 'type': 'string', 'enum': ['pre', 'post', ''] },
        'dagName':       { 'type': 'string' },
        'nodeName':      { 'type': 'string' },
        'output':        { 'type': ['string', 'null'] },
        'message':       { 'type': 'string' },
        'placementPath': { 'type': 'array', 'items': { 'type': 'string' } },
      },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['variant', 'correlationId', 'code', 'message', 'recoverable'],
      'properties': {
        'variant':       { 'type': 'string', 'const': 'error' },
        'correlationId': { 'type': ['string', 'null'] },
        'code':          { 'type': 'string' },
        'message':       { 'type': 'string' },
        'recoverable':   { 'type': 'boolean' },
      },
      'additionalProperties': false,
    },
  ],
} as const;

/** TypeScript type derived from `BridgeMessageSchema` via `json-schema-to-ts`. */
export type BridgeMessageType = FromSchema<typeof BridgeMessageSchema>;

// ---------------------------------------------------------------------------
// BridgeMessageBuilder
// ---------------------------------------------------------------------------

/**
 * Static factory for constructing `BridgeMessage` values. The type
 * `BridgeMessage` and this factory are distinct identifiers per the
 * canonical-names rule: `BridgeMessage` is the type; `BridgeMessageBuilder`
 * is the value that builds instances.
 */
export class BridgeMessageBuilder {
  private constructor() { /* static class */ }

  /**
   * Build a channel-scoped error BridgeMessage with `correlationId: null`.
   * Use when no specific request is in flight (e.g. init failures, transport
   * setup errors, invalid message receipts).
   */
  static invalid(code: string, message: string): BridgeMessageType & { variant: 'error' } {
    return {
      'variant': 'error',
      'correlationId': null,
      'code': code,
      'message': message,
      'recoverable': false,
    };
  }
}
