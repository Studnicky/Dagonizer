import type { FromSchema } from 'json-schema-to-ts';

import { NodeErrorProperties, NodeErrorSchema } from '../node/NodeError.js';
import { NodeWarningProperties, NodeWarningSchema } from '../node/NodeWarning.js';
import { DAGLifecycleStateSchema } from '../state-machines/DAGLifecycleState.js';

const TransientLifecycleSchema = {
  'type': DAGLifecycleStateSchema.type,
  'required': DAGLifecycleStateSchema.required,
  'properties': DAGLifecycleStateSchema.properties,
  'additionalProperties': false,
} as const;

/**
 * Plain transient worker-transfer snapshot of one node state.
 *
 * This is the selected runtime state encoded by `GraphStateTransferCodec` for
 * isolate execution. It avoids full state-graph projection and indexing.
 */
export const TransientNodeStateSchema = {
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['domain', 'graphDomain', 'metadata', 'errors', 'warnings', 'retries', 'lifecycle'],
  'properties': {
    'domain': { 'type': 'object' },
    'graphDomain': { 'type': 'object' },
    'metadata': { 'type': 'object' },
    'errors': {
      'type': 'array',
      'items': {
        'type': 'object',
        'required': NodeErrorSchema.required,
        'properties': NodeErrorProperties,
        'additionalProperties': false,
      },
    },
    'warnings': {
      'type': 'array',
      'items': {
        'type': 'object',
        'required': NodeWarningSchema.required,
        'properties': NodeWarningProperties,
        'additionalProperties': false,
      },
    },
    'retries': {
      'type': 'object',
      'additionalProperties': { 'type': 'number' },
    },
    'lifecycle': TransientLifecycleSchema,
  },
  'additionalProperties': false,
} as const;

export type TransientNodeStateType = FromSchema<typeof TransientNodeStateSchema>;

/** Container-response projection contract for transient node state. */
export const TransientNodeStateSelectionSchema = {
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['mode', 'domainPaths', 'metadataKeys'],
  'properties': {
    'mode': {
      'type': 'string',
      'enum': ['full', 'selection'],
    },
    'domainPaths': {
      'type': 'array',
      'items': { 'type': 'string', 'minLength': 1 },
    },
    'metadataKeys': {
      'type': 'array',
      'items': { 'type': 'string', 'minLength': 1 },
    },
  },
  'additionalProperties': false,
} as const;

export type TransientNodeStateSelectionType = FromSchema<typeof TransientNodeStateSelectionSchema>;

/** Container-response projection plan for transient node state. */
export const TransientNodeStateResponseStateSchema = {
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['defaultSelection', 'outputSelections'],
  'properties': {
    'defaultSelection': TransientNodeStateSelectionSchema,
    'outputSelections': {
      'type': 'object',
      'additionalProperties': TransientNodeStateSelectionSchema,
    },
  },
  'additionalProperties': false,
} as const;

type TransientNodeStateResponseStateWireType = FromSchema<typeof TransientNodeStateResponseStateSchema>;
export type TransientNodeStateResponseStateType = Omit<TransientNodeStateResponseStateWireType, 'defaultSelection' | 'outputSelections'> & {
  defaultSelection: TransientNodeStateSelectionType;
  outputSelections: Record<string, TransientNodeStateSelectionType>;
};
