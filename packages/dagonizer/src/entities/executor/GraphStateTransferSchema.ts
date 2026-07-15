const MetadataProperties = {
  'dagIri': { 'type': 'string', 'minLength': 1 },
  'placementPath': { 'type': 'array', 'items': { 'type': 'string' } },
  'placementIri': { 'type': 'string', 'minLength': 1 },
  'stateGraphIri': { 'type': 'string', 'minLength': 1 },
  'createdAt': { 'type': 'string', 'minLength': 1 },
  'byteSize': { 'type': 'number', 'minimum': 0 },
  'quadCount': { 'type': 'integer', 'minimum': 0 },
  'jsonLd': { 'type': 'object', 'required': ['@context', '@graph'], 'additionalProperties': true },
} as const;

const InlineProperties = {
  'mode': { 'type': 'string', 'const': 'inline-nquads' },
  'format': { 'type': 'string', 'const': 'application/n-quads' },
  'runIri': { 'type': 'string', 'minLength': 1 },
  'graphIris': { 'type': 'array', 'items': { 'type': 'string', 'minLength': 1 } },
  'nquads': { 'type': 'string' },
  'hash': { 'type': 'string', 'minLength': 1 },
  ...MetadataProperties,
} as const;

const ReferenceProperties = {
  'mode': { 'type': 'string', 'const': 'graph-ref' },
  'runIri': { 'type': 'string', 'minLength': 1 },
  'graphSnapshotRef': { 'type': 'string', 'minLength': 1 },
  'format': { 'type': 'string', 'const': 'application/n-quads' },
  'graphIris': { 'type': 'array', 'items': { 'type': 'string', 'minLength': 1 } },
  'hash': { 'type': 'string', 'minLength': 1 },
  ...MetadataProperties,
} as const;

const SharedProperties = {
  'mode': { 'type': 'string', 'const': 'shared-endpoint' },
  'runIri': { 'type': 'string', 'minLength': 1 },
  'endpoint': { 'type': 'string', 'minLength': 1 },
  'graphIris': { 'type': 'array', 'items': { 'type': 'string', 'minLength': 1 } },
  'lease': { 'type': 'string', 'minLength': 1 },
  ...MetadataProperties,
} as const;

const DeltaProperties = {
  'mode': { 'type': 'string', 'enum': ['delta-ref', 'inline-delta-nquads'] },
  'runIri': { 'type': 'string', 'minLength': 1 },
  'baseSnapshotRef': { 'type': 'string', 'minLength': 1 },
  'baseRevision': { 'type': 'string', 'minLength': 1 },
  'revision': { 'type': 'string', 'minLength': 1 },
  'graphIris': { 'type': 'array', 'items': { 'type': 'string', 'minLength': 1 } },
  'additions': { 'type': 'string' },
  'deletions': { 'type': 'string' },
  'hash': { 'type': 'string', 'minLength': 1 },
  ...MetadataProperties,
} as const;

/** JSON Schema for every graph-state transfer mode. */
export const GraphStateTransferSchema = {
  'oneOf': [
    {
      'type': 'object',
      'required': ['mode', 'format', 'runIri', 'graphIris', 'nquads', 'hash', 'dagIri', 'placementPath', 'placementIri', 'stateGraphIri', 'createdAt', 'byteSize', 'quadCount', 'jsonLd'],
      'properties': InlineProperties,
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['mode', 'runIri', 'graphSnapshotRef', 'format', 'graphIris', 'hash', 'dagIri', 'placementPath', 'placementIri', 'stateGraphIri', 'createdAt', 'byteSize', 'quadCount', 'jsonLd'],
      'properties': ReferenceProperties,
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['mode', 'runIri', 'endpoint', 'graphIris', 'lease', 'dagIri', 'placementPath', 'placementIri', 'stateGraphIri', 'createdAt', 'byteSize', 'quadCount', 'jsonLd'],
      'properties': SharedProperties,
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['mode', 'runIri', 'baseSnapshotRef', 'graphIris', 'additions', 'deletions', 'hash', 'dagIri', 'placementPath', 'placementIri', 'stateGraphIri', 'createdAt', 'byteSize', 'quadCount', 'jsonLd'],
      'properties': DeltaProperties,
      'additionalProperties': false,
    },
  ],
} as const;
