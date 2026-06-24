/**
 * DAGDocument: static-class domain module for DAG document (de)serialization.
 *
 * Owns the single `unknown` ingest boundary where external data enters the
 * package. All other engine code receives already-validated `DAG` values.
 *
 * The three operations here have no dispatch responsibility and no dependency
 * on dispatcher state — they operate purely on the wire shape.
 */

import type { DAGType } from '../entities/dag/DAG.js';
import { ValidationError } from '../errors/index.js';
import { Validator } from '../validation/Validator.js';

/**
 * Options for `DAGDocument.load` and `DAGDocument.ofValue`.
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

/**
 * DAG document (de)serialization domain.
 *
 * Three operations, no instances:
 *   - `DAGDocument.load(json)` — parse JSON and validate against `DAGSchema`.
 *   - `DAGDocument.ofValue(value)` — validate an already-decoded value.
 *   - `DAGDocument.serialize(dag)` — pretty-print to JSON (2-space indent).
 *   - `DAGDocument.serializeCompact(dag)` — compact JSON (no whitespace).
 */
export class DAGDocument {
  private constructor() {
    // Static-only class. No instances.
  }

  /**
   * Parse JSON and validate against `DAGSchema`. The single permitted ingest
   * boundary where `unknown` enters the package.
   *
   * Throws `ValidationError` for malformed JSON or schema-noncompliant input.
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
      const message = error instanceof Error ? error.message : String(error);
      throw new ValidationError(`Invalid JSON: ${message}`);
    }
    const merged = options.overrides !== undefined
      ? { ...(parsed as Record<string, unknown>), ...options.overrides }
      : parsed;
    return Validator.dag.validate(merged);
  }

  /**
   * Parse an already-decoded value and validate. Same boundary semantics as
   * `load` but skips JSON.parse for callers that have already decoded.
   *
   * @param options.overrides — field overrides merged into the decoded value
   * before schema validation. Use to inject runtime values (e.g. concurrency)
   * without mutating the source document.
   */
  static ofValue(value: unknown, options: DAGDocumentLoadOptionsType = {}): DAGType {
    const merged = options.overrides !== undefined
      ? { ...(value as Record<string, unknown>), ...options.overrides }
      : value;
    return Validator.dag.validate(merged);
  }

  /** Serialize a DAG to pretty JSON (2-space indent). */
  static serialize(dag: DAGType): string {
    return JSON.stringify(dag, null, 2);
  }

  /** Serialize a DAG to compact JSON (no whitespace). */
  static serializeCompact(dag: DAGType): string {
    return JSON.stringify(dag);
  }
}
