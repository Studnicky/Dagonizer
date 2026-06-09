/**
 * DagContainerError: error class for container infrastructure failures.
 *
 * Extends DAGError so callers can distinguish container-lifecycle faults
 * (destroyed, eviction, init failure) from DAG execution errors. All internal
 * throws in DagContainerBase use this class; no bare `new Error` escapes.
 */

import { DAGError } from '../errors/DAGError.js';

export class DagContainerError extends DAGError {
  constructor(message: string, options: { context?: Record<string, unknown>; cause?: Error } = {}) {
    super(message, { ...options, "code": 'DAG_CONTAINER_ERROR' });
    this.name = 'DagContainerError';
  }
}
