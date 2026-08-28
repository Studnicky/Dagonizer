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
 * (not a top-level `terminalOutput`). The inline shapes structurally reuse
 * the canonical ExecutionRequest / ExecutionResponse schema members without
 * embedding their root metadata or requiring $ref resolution.
 *
 * Parent → host: init, execute, abort, shutdown
 * Host → parent: ready, result, intermediate, instrumentation, error, log
 *
 * JSON Schema 2020-12 entity: schema value + FromSchema-derived TypeScript type.
 */

import type { FromSchema } from 'json-schema-to-ts';

import { GRAPH_STATE_TRANSFER_FORMATS } from '../../contracts/GraphStateTransferFormat.js';

import { ExecutionRequestSchema, type ExecutionRequestType } from './ExecutionRequest.js';
import { ExecutionResponseSchema, type ExecutionResponseType } from './ExecutionResponse.js';

// ---------------------------------------------------------------------------
// Inline structural shapes
// ---------------------------------------------------------------------------

/**
 * Root-metadata-free dag-only ExecutionRequest shape.
 * No `variant` discriminant; no `nodeName`. DagHost runs only whole DAGs.
 * `graphState` is the batch-level N-Quads transfer; `items`
 * carries one `{ id, runIri }` entry per batch item.
 */
const InlineExecutionRequestShape = {
  'type': ExecutionRequestSchema.type,
  'required': ExecutionRequestSchema.required,
  'properties': ExecutionRequestSchema.properties,
  'additionalProperties': ExecutionRequestSchema.additionalProperties,
} as const;

/**
 * Root-metadata-free dag-only ExecutionResponse shape.
 * `graphState` is the batch-level N-Quads transfer; per-item
 * results live in
 * `items[*].{ id, runIri, terminalOutcome, errors, intermediates }`.
 */
const InlineExecutionResponseShape = {
  'type': ExecutionResponseSchema.type,
  'required': ExecutionResponseSchema.required,
  'properties': ExecutionResponseSchema.properties,
  'additionalProperties': ExecutionResponseSchema.additionalProperties,
} as const;

const InstrumentationEventShape = {
  'type': 'object',
  'required': ['correlationId', 'hook', 'phase', 'dagName', 'nodeName', 'output', 'message', 'placementPath'],
  'properties': {
    'correlationId': { 'type': 'string' },
    'hook':          { 'type': 'string', 'enum': ['nodeStart', 'nodeEnd', 'phaseEnter', 'phaseExit', 'error'] },
    'phase':         { 'type': 'string', 'enum': ['pre', 'post', ''] },
    'dagName':       { 'type': 'string' },
    'nodeName':      { 'type': 'string' },
    'output':        { 'type': ['string', 'null'] },
    'message':       { 'type': 'string' },
    'placementPath': { 'type': 'array', 'items': { 'type': 'string' } },
  },
  'additionalProperties': false,
} as const;

// ---------------------------------------------------------------------------
// BridgeMessage schema
// ---------------------------------------------------------------------------

export const BridgeMessageSchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer/BridgeMessage',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'oneOf': [
    // ── parent → host ────────────────────────────────────────────────────────
    {
      'type': 'object',
      'required': ['variant', 'registryModule', 'registryVersion', 'servicesConfig', 'graphStateTransferFormats'],
      'properties': {
        'variant':         { 'type': 'string', 'const': 'init' },
        'registryModule':  { 'type': 'string', 'minLength': 1 },
        'registryVersion': { 'type': 'string', 'minLength': 1 },
        'servicesConfig':  { 'type': 'object' },
        'graphStateTransferFormats': {
          'type': 'array',
          'minItems': 1,
          'uniqueItems': true,
          'items': {
            'type': 'string',
            'enum': GRAPH_STATE_TRANSFER_FORMATS,
          },
        },
        // R2: opt-out for WorkerObserver's per-flush instrumentation-event
        // dedup. Optional — the genuine boundary default (true) lives in
        // WorkerObserver, not here. See WorkerObserver.ts.
        'coalesceInstrumentation': { 'type': 'boolean' },
        // Optional worker-side instrumentation path-depth cap. When set,
        // WorkerObserver drops deeper events before they cross the boundary.
        'instrumentationPlacementPathDepth': {
          'type': 'integer',
          'minimum': 0,
        },
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
      'required': ['variant', 'registryVersion', 'capabilities', 'graphStateTransferFormats'],
      'properties': {
        'variant':         { 'type': 'string', 'const': 'ready' },
        'registryVersion': { 'type': 'string', 'minLength': 1 },
        'capabilities':    { 'type': 'array', 'items': { 'type': 'string' } },
        'graphStateTransferFormats': {
          'type': 'array',
          'minItems': 1,
          'uniqueItems': true,
          'items': {
            'type': 'string',
            'enum': GRAPH_STATE_TRANSFER_FORMATS,
          },
        },
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
        'variant': { 'type': 'string', 'const': 'instrumentation' },
        ...InstrumentationEventShape.properties,
      },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['variant', 'correlationId', 'items'],
      'properties': {
        'variant':       { 'type': 'string', 'const': 'instrumentationBatch' },
        'correlationId': { 'type': 'string' },
        'items': {
          'type': 'array',
          'minItems': 1,
          'items': InstrumentationEventShape,
        },
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
type BridgeMessageWireType = FromSchema<typeof BridgeMessageSchema>;
type ExecuteMessageWireType = Extract<BridgeMessageWireType, { variant: 'execute' }>;
type ResultMessageWireType = Extract<BridgeMessageWireType, { variant: 'result' }>;
type ExecuteMessageType = Omit<ExecuteMessageWireType, 'request'> & { request: ExecutionRequestType };
type ResultMessageType = Omit<ResultMessageWireType, 'response'> & { response: ExecutionResponseType };

/** TypeScript bridge contract with canonical graph transfer typing at both wire boundaries. */
export type BridgeMessageType = Exclude<BridgeMessageWireType, ExecuteMessageWireType | ResultMessageWireType> | ExecuteMessageType | ResultMessageType;

// ---------------------------------------------------------------------------
// BridgeMessage
// ---------------------------------------------------------------------------

/**
 * Static factory for constructing `BridgeMessage` values.
 */
export class BridgeMessage {
  private constructor() { /* static class */ }

  /**
   * Build a channel-scoped error BridgeMessage with `correlationId: null`.
   * Use when no specific request is in flight (e.g. init failures, transport
   * setup errors, invalid message receipts).
   */
  static create(options: { code: string; message: string }): BridgeMessageType & { variant: 'error' } {
    return {
      'variant': 'error',
      'correlationId': null,
      'code': options.code,
      'message': options.message,
      'recoverable': false,
    };
  }
}
