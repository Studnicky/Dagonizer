/**
 * BridgeMessage: kind-discriminated protocol message for the parent ↔ DagHost channel.
 *
 * One oneOf schema with inline branches (DAG.ts DAGNodeEntrySchema style).
 * Every branch uses `additionalProperties: false`; every field is required
 * per branch so producers never emit absent fields.
 *
 * The `execute` branch carries a dag-only request: no `kind` discriminant
 * on the request, no `nodeName`. A DagHost runs only whole DAGs.
 * The `result` branch carries a dag-only response using `terminalOutput`
 * (not `output`). The inline shapes are structural copies of the canonical
 * ExecutionRequest / ExecutionResponse schemas to avoid $ref resolution at
 * compile time.
 *
 * Parent → host: init, execute, abort, shutdown
 * Host → parent: ready, result, intermediate, instrumentation, error, log
 *
 * JSON Schema 2020-12 entity: schema value + FromSchema-derived TypeScript type.
 */

import type { FromSchema } from 'json-schema-to-ts';

// ---------------------------------------------------------------------------
// Inline shape copies
// ---------------------------------------------------------------------------

const InlineNodeErrorShape = {
  'type': 'object',
  'required': ['code', 'message', 'operation', 'recoverable', 'timestamp'],
  'properties': {
    'code':        { 'type': 'string' },
    'context':     { 'type': 'object' },
    'message':     { 'type': 'string' },
    'operation':   { 'type': 'string' },
    'recoverable': { 'type': 'boolean' },
    'timestamp':   { 'type': 'string' },
  },
  'additionalProperties': false,
} as const;

/**
 * Inline copy of the dag-only ExecutionRequest shape.
 * See ExecutionRequest.ts for the canonical schema.
 * No `kind` discriminant; no `nodeName`. DagHost runs only whole DAGs.
 */
const InlineExecutionRequestShape = {
  'type': 'object',
  'required': ['dagName', 'placementPath', 'stateSnapshot', 'timeoutMs', 'requestId'],
  'properties': {
    'dagName':       { 'type': 'string', 'minLength': 1 },
    'placementPath': { 'type': 'array', 'items': { 'type': 'string' } },
    'stateSnapshot': { 'type': 'object' },
    'timeoutMs':     { 'type': ['number', 'null'] },
    'requestId':     { 'type': 'string', 'minLength': 1 },
  },
  'additionalProperties': false,
} as const;

/**
 * Inline copy of the dag-only ExecutionResponse shape.
 * See ExecutionResponse.ts for the canonical schema.
 * Uses `terminalOutput` (not `output`).
 * The ExecutorIntermediate items shape (output, skipped, nodeName) is an
 * inline copy of ExecutorIntermediate.ts — intentionally duplicated to
 * avoid $ref resolution at compile time.
 */
const InlineExecutionResponseShape = {
  'type': 'object',
  'required': ['requestId', 'terminalOutput', 'errors', 'stateSnapshot', 'intermediates'],
  'properties': {
    'requestId':      { 'type': 'string', 'minLength': 1 },
    'terminalOutput': { 'type': 'string' },
    'errors': {
      'type': 'array',
      'items': InlineNodeErrorShape,
    },
    'stateSnapshot': { 'type': ['object', 'null'] },
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
      'required': ['kind', 'registryModule', 'registryVersion', 'servicesConfig'],
      'properties': {
        'kind':            { 'type': 'string', 'const': 'init' },
        'registryModule':  { 'type': 'string', 'minLength': 1 },
        'registryVersion': { 'type': 'string', 'minLength': 1 },
        'servicesConfig':  { 'type': 'object' },
      },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['kind', 'request'],
      'properties': {
        'kind':    { 'type': 'string', 'const': 'execute' },
        'request': InlineExecutionRequestShape,
      },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['kind', 'requestId', 'reason'],
      'properties': {
        'kind':      { 'type': 'string', 'const': 'abort' },
        'requestId': { 'type': 'string' },
        'reason':    { 'type': 'string' },
      },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['kind'],
      'properties': {
        'kind': { 'type': 'string', 'const': 'shutdown' },
      },
      'additionalProperties': false,
    },
    // ── host → parent ────────────────────────────────────────────────────────
    {
      'type': 'object',
      'required': ['kind', 'registryVersion', 'capabilities'],
      'properties': {
        'kind':            { 'type': 'string', 'const': 'ready' },
        'registryVersion': { 'type': 'string', 'minLength': 1 },
        'capabilities':    { 'type': 'array', 'items': { 'type': 'string' } },
      },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['kind', 'response'],
      'properties': {
        'kind':     { 'type': 'string', 'const': 'result' },
        'response': InlineExecutionResponseShape,
      },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['kind', 'requestId', 'nodeName', 'output', 'placementPath'],
      'properties': {
        'kind':          { 'type': 'string', 'const': 'intermediate' },
        'requestId':     { 'type': 'string' },
        'nodeName':      { 'type': 'string' },
        'output':        { 'type': ['string', 'null'] },
        'placementPath': { 'type': 'array', 'items': { 'type': 'string' } },
      },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['kind', 'requestId', 'hook', 'phase', 'dagName', 'nodeName', 'output', 'message', 'placementPath'],
      'properties': {
        'kind':          { 'type': 'string', 'const': 'instrumentation' },
        'requestId':     { 'type': 'string' },
        'hook':          { 'type': 'string', 'enum': ['nodeStart', 'nodeEnd', 'phaseEnter', 'phaseExit', 'error', 'contractWarning'] },
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
      'required': ['kind', 'requestId', 'code', 'message', 'recoverable'],
      'properties': {
        'kind':        { 'type': 'string', 'const': 'error' },
        'requestId':   { 'type': ['string', 'null'] },
        'code':        { 'type': 'string' },
        'message':     { 'type': 'string' },
        'recoverable': { 'type': 'boolean' },
      },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['kind', 'level', 'component', 'operation', 'message'],
      'properties': {
        'kind':      { 'type': 'string', 'const': 'log' },
        'level':     { 'type': 'string', 'enum': ['debug', 'info', 'warn', 'error'] },
        'component': { 'type': 'string' },
        'operation': { 'type': 'string' },
        'message':   { 'type': 'string' },
      },
      'additionalProperties': false,
    },
  ],
} as const;

/** TypeScript type derived from `BridgeMessageSchema` via `json-schema-to-ts`. */
export type BridgeMessage = FromSchema<typeof BridgeMessageSchema>;
