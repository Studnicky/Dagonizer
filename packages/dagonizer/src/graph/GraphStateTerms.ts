import { DagonizerContexts } from '../context/DagonizerContexts.js';

/** Stable graph vocabulary and IRI derivation for graph-backed execution state. */
export class GraphStateTerms {
  private constructor() { /* static-only */ }

  static readonly DAGONIZER = {
    'namespace': 'https://noocodec.dev/ontology/dagonizer/',
    'Run': 'https://noocodec.dev/ontology/dagonizer/Run',
    'RunDetail': 'https://noocodec.dev/ontology/dagonizer/RunDetail',
    'Transient': 'https://noocodec.dev/ontology/dagonizer/transient',
    'Open': 'https://noocodec.dev/ontology/dagonizer/open',
    'DAG': 'https://noocodec.dev/ontology/dagonizer/DAG',
    'Placement': 'https://noocodec.dev/ontology/dagonizer/Placement',
    'NodeImplementation': 'https://noocodec.dev/ontology/dagonizer/NodeImplementation',
    'PlacementExecution': 'https://noocodec.dev/ontology/dagonizer/PlacementExecution',
    'StateCell': 'https://noocodec.dev/ontology/dagonizer/StateCell',
    'StateValue': 'https://noocodec.dev/ontology/dagonizer/StateValue',
    'StateObject': 'https://noocodec.dev/ontology/dagonizer/StateObject',
    'StateArray': 'https://noocodec.dev/ontology/dagonizer/StateArray',
    'StateNull': 'https://noocodec.dev/ontology/dagonizer/StateNull',
    'StateKey': 'https://noocodec.dev/ontology/dagonizer/key',
    'StateValuePredicate': 'https://noocodec.dev/ontology/dagonizer/value',
    'StateMember': 'https://noocodec.dev/ontology/dagonizer/member',
    'StateIndex': 'https://noocodec.dev/ontology/dagonizer/index',
    'StateField': 'https://noocodec.dev/ontology/dagonizer/stateField',
    'Checkpoint': 'https://noocodec.dev/ontology/dagonizer/Checkpoint',
    'Workset': 'https://noocodec.dev/ontology/dagonizer/Workset',
    'BatchItem': 'https://noocodec.dev/ontology/dagonizer/BatchItem',
    'Warning': 'https://noocodec.dev/ontology/dagonizer/Warning',
    'Error': 'https://noocodec.dev/ontology/dagonizer/Error',
    'CompactedRun': 'https://noocodec.dev/ontology/dagonizer/CompactedRun',
    'GraphStatus': 'https://noocodec.dev/ontology/dagonizer/graphStatus',
    'Closed': 'https://noocodec.dev/ontology/dagonizer/closed',
    'ClosedAt': 'https://noocodec.dev/ontology/dagonizer/closedAt',
    'SourceGraph': 'https://noocodec.dev/ontology/dagonizer/sourceGraph',
    'QuadCount': 'https://noocodec.dev/ontology/dagonizer/quadCount',
    'ProtectsGraph': 'https://noocodec.dev/ontology/dagonizer/protectsGraph',
    'ReferencesGraph': 'https://noocodec.dev/ontology/dagonizer/referencesGraph',
    'RetentionClass': 'https://noocodec.dev/ontology/dagonizer/retentionClass',
    'Durable': 'https://noocodec.dev/ontology/dagonizer/durable',
    'Lifecycle': 'https://noocodec.dev/ontology/dagonizer/lifecycleState',
    'LifecycleVariant': 'https://noocodec.dev/ontology/dagonizer/lifecycle',
    'LifecycleEvent': 'https://noocodec.dev/ontology/dagonizer/lifecycleEvent',
    'CurrentLifecycle': 'https://noocodec.dev/ontology/dagonizer/currentLifecycle',
    'StartedAt': 'https://noocodec.dev/ontology/dagonizer/startedAt',
    'FinishedAt': 'https://noocodec.dev/ontology/dagonizer/finishedAt',
    'Reason': 'https://noocodec.dev/ontology/dagonizer/reason',
    'CorrelationKey': 'https://noocodec.dev/ontology/dagonizer/correlationKey',
    'ErrorMessage': 'https://noocodec.dev/ontology/dagonizer/errorMessage',
    'ErrorPayload': 'https://noocodec.dev/ontology/dagonizer/errorPayload',
    'Attempt': 'https://noocodec.dev/ontology/dagonizer/attempt',
    'AttemptCount': 'https://noocodec.dev/ontology/dagonizer/count',
    'AttemptKey': 'https://noocodec.dev/ontology/dagonizer/key',
    'Completed': 'https://noocodec.dev/ontology/dagonizer/completed',
    'CompactionActivity': 'https://noocodec.dev/ontology/dagonizer/CompactionActivity',
    'CompactsGraph': 'https://noocodec.dev/ontology/dagonizer/compactsGraph',
    'Revision': 'https://noocodec.dev/ontology/dagonizer/Revision',
    'RevisionValue': 'https://noocodec.dev/ontology/dagonizer/revisionValue',
    'RevisionOf': 'https://noocodec.dev/ontology/dagonizer/revisionOf',
    'GeneratedAt': 'https://noocodec.dev/ontology/dagonizer/generatedAt',
    'Dataset': 'https://noocodec.dev/ontology/dagonizer/dataset',
    'HasStateCell': 'https://noocodec.dev/ontology/dagonizer/hasStateCell',
    'PlacementPredicate': 'https://noocodec.dev/ontology/dagonizer/placement',
    'Output': 'https://noocodec.dev/ontology/dagonizer/output',
  } as const;
  static readonly PROV = 'http://www.w3.org/ns/prov#';
  static readonly XSD = {
    'boolean': 'http://www.w3.org/2001/XMLSchema#boolean',
    'dateTime': 'http://www.w3.org/2001/XMLSchema#dateTime',
    'double': 'http://www.w3.org/2001/XMLSchema#double',
    'integer': 'http://www.w3.org/2001/XMLSchema#integer',
    'string': 'http://www.w3.org/2001/XMLSchema#string',
  } as const;
  static readonly JSON_LD_CONTEXT = DagonizerContexts.GRAPH_STATE;
  static runGraphIri(runIri: string): string {
    return `${runIri}#state`;
  }

  static summaryGraphIri(graphIri: string): string {
    return `${graphIri}/summary`;
  }

  static revisionGraphIri(): string {
    return `${GraphStateTerms.DAGONIZER.namespace}revisions`;
  }

  static revisionIri(revision: string): string {
    return `${GraphStateTerms.DAGONIZER.namespace}revision/${encodeURIComponent(revision)}`;
  }

  static placementExecutionIri(runIri: string, placementIri: string): string {
    return `${runIri}/placement/${encodeURIComponent(placementIri)}`;
  }

  static stateCellIri(runIri: string, key: string): string {
    return `${GraphStateTerms.runGraphIri(runIri)}/state/${encodeURIComponent(key)}`;
  }

  static stateFieldIri(key: string): string {
    if (key.startsWith('domain.')) return `${GraphStateTerms.DAGONIZER.namespace}${encodeURIComponent(key.slice('domain.'.length))}`;
    if (key.startsWith('metadata.')) return `${GraphStateTerms.DAGONIZER.namespace}metadata/${encodeURIComponent(key.slice('metadata.'.length))}`;
    return `${GraphStateTerms.DAGONIZER.namespace}state/${encodeURIComponent(key)}`;
  }

  static lifecycleVariantIri(variant: string): string {
    return `${GraphStateTerms.DAGONIZER.namespace}${variant}`;
  }

  static nestedFieldIri(key: string): string {
    return `${GraphStateTerms.DAGONIZER.namespace}${encodeURIComponent(key)}`;
  }

  static checkpointIri(runIri: string, checkpointId: string): string {
    return `${runIri}/checkpoint/${encodeURIComponent(checkpointId)}`;
  }

  static worksetIri(runIri: string, worksetId: string): string {
    return `${runIri}/workset/${encodeURIComponent(worksetId)}`;
  }

  static batchItemIri(worksetIri: string, index: number): string {
    return `${worksetIri}/item/${index}`;
  }

  static attemptIri(runIri: string, key: string): string {
    return `${runIri}/attempt/${encodeURIComponent(key)}`;
  }

  static runIri(dagIri: string, executionId: string): string {
    return `${dagIri}/run/${encodeURIComponent(executionId)}`;
  }
}
