/**
 * DAGDocument: static-class domain module for DAG document serialization.
 *
 * Owns the single `unknown` ingest boundary where external data enters the
 * package. All other engine code receives already-validated `DAG` values.
 */

import type { DAGType } from '../entities/dag/DAG.js';
import { DAGError } from '../errors/index.js';
import { Validator } from '../validation/Validator.js';

/**
 * Options for `DAGDocument.load`.
 */
export type DAGDocumentLoadOptionsType = {
  /**
   * Field overrides applied to the decoded DAG before schema validation.
   * Use to inject runtime values (e.g. concurrency from config) without
   * mutating the source document.
   *
   * Example: { nodes: [ ...dag.nodes.map(n => n.name === 'scatter' ? { ...n, concurrency: 16 } : n) ] }
   */
  readonly overrides?: Partial<DAGType>;
};

/** DAG document serialization domain. */
export class DAGDocument {
  private constructor() {
    // Static-only class. No instances.
  }

  /**
   * Parse JSON and validate against `DAGSchema`. The single permitted ingest
   * boundary where `unknown` enters the package.
   *
   * Throws `DAGError` (code `VALIDATION_ERROR`) for malformed JSON or
   * schema-noncompliant input.
   *
   * @param options.overrides — field overrides merged into the decoded DAG
   * before schema validation. Use to inject runtime values (e.g. concurrency)
   * without mutating the source document.
   */
  static load(json: string, options: DAGDocumentLoadOptionsType = {}): DAGType {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      const message = DAGError.messageOf(error);
      throw new DAGError(`Invalid JSON: ${message}`, { 'code': 'VALIDATION_ERROR' });
    }
    if (options.overrides !== undefined) {
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new DAGError('Cannot apply overrides: parsed JSON must be an object', { 'code': 'VALIDATION_ERROR' });
      }
      return Validator.dag.validate({ ...parsed, ...options.overrides });
    }
    return Validator.dag.validate(parsed);
  }

  /** Serialize a DAG to pretty JSON (2-space indent). */
  static serialize(dag: DAGType): string {
    return JSON.stringify(dag, null, 2);
  }
}
