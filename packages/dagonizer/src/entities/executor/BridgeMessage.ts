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

import type { ExecutionRequestType } from './ExecutionRequest.js';
import type { ExecutionResponseType } from './ExecutionResponse.js';
import { GraphStateJsonLdSchema, GraphStateTransferSchema } from './GraphStateTransferSchema.js';

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
 * `graphState` is the batch-level `GraphStateTransfer` union; `items` carries
 * one `{ id, runIri, jsonLd? }` entry per batch item.
 */
const InlineExecutionRequestShape = {
  'type': 'object',
  'required': ['dagName', 'placementPath', 'graphState', 'items', 'timeoutMs', 'correlationId'],
  'properties': {
    'dagName':       { 'type': 'string', 'minLength': 1 },
    'placementPath': { 'type': 'array', 'items': { 'type': 'string' } },
    'graphState':    GraphStateTransferSchema,
    'items': {
      'type': 'array',
      'minItems': 1,
      'items': {
        'type': 'object',
        'required': ['id', 'runIri'],
        'properties': {
          'id':     { 'type': 'string', 'minLength': 1 },
          'runIri': { 'type': 'string', 'minLength': 1 },
          'jsonLd': GraphStateJsonLdSchema,
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
 * `graphState` is the batch-level `GraphStateTransfer` union; per-item results
 * live in `items[*].{ id, runIri, terminalOutcome, jsonLd? }`.
 * The ExecutorIntermediate items shape (output, skipped, nodeName) is an
 * inline copy of ExecutorIntermediate.ts — intentionally duplicated to
 * avoid $ref resolution at compile time.
 */
const InlineExecutionResponseShape = {
  'type': 'object',
  'required': ['correlationId', 'graphState', 'items', 'errors', 'intermediates'],
  'properties': {
    'correlationId': { 'type': 'string', 'minLength': 1 },
    'graphState':    GraphStateTransferSchema,
    'items': {
      'type': 'array',
      'minItems': 1,
      'items': {
        'type': 'object',
        'required': ['id', 'runIri', 'terminalOutcome'],
        'properties': {
          'id':              { 'type': 'string', 'minLength': 1 },
          'runIri':          { 'type': 'string', 'minLength': 1 },
          'terminalOutcome': { 'type': 'string' },
          'jsonLd':          GraphStateJsonLdSchema,
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
      'required': ['variant', 'registryModule', 'registryVersion', 'servicesConfig'],
      'properties': {
        'variant':         { 'type': 'string', 'const': 'init' },
        'registryModule':  { 'type': 'string', 'minLength': 1 },
        'registryVersion': { 'type': 'string', 'minLength': 1 },
        'servicesConfig':  { 'type': 'object' },
        'graphStateTransferFormats': {
          'type': 'array',
          'items': {
            'type': 'string',
            'enum': ['application/n-quads', 'application/ld+json'],
          },
        },
        // R2: opt-out for WorkerObserver's per-flush instrumentation-event
        // dedup. Optional — the genuine boundary default (true) lives in
        // WorkerObserver, not here. See WorkerObserver.ts.
        'coalesceInstrumentation': { 'type': 'boolean' },
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
        'graphStateTransferFormats': {
          'type': 'array',
          'items': {
            'type': 'string',
            'enum': ['application/n-quads', 'application/ld+json'],
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
