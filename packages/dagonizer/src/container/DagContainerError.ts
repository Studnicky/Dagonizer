/**
 * DagContainerError: error class for container infrastructure failures.
 *
 * Extends DAGError so callers can distinguish container-lifecycle faults
 * (destroyed, eviction, init failure) from DAG execution errors. All internal
 * throws in DagContainerBase use this class; no bare `new Error` escapes.
 */

import { DAGError } from '../errors/DAGError.js';

export class DagContainerError extends DAGError {
  constructor(message: string, context?: Record<string, unknown>, options?: ErrorOptions) {
    super(message, 'DAG_CONTAINER_ERROR', context, options);
    this.name = 'DagContainerError';
  }
}
