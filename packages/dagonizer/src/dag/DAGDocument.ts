/**
 * DAGDocument: static-class domain module for DAG document (de)serialization.
 *
 * Owns the single `unknown` ingest boundary where external data enters the
 * package. All other engine code receives already-validated `DAG` values.
 *
 * The three operations here have no dispatch responsibility and no dependency
 * on dispatcher state — they operate purely on the wire shape.
 */

import type { DAG } from '../entities/dag/DAG.js';
import { ValidationError } from '../errors/index.js';
import { Validator } from '../validation/Validator.js';

/**
 * DAG document (de)serialization domain.
 *
 * Three operations, no instances:
 *   - `DAGDocument.load(json)` — parse JSON and validate against `DAGSchema`.
 *   - `DAGDocument.fromValue(value)` — validate an already-decoded value.
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
   */
  static load(json: string): DAG {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ValidationError(`Invalid JSON: ${message}`);
    }
    return Validator.dag.validate(parsed);
  }

  /**
   * Parse an already-decoded value and validate. Same boundary semantics as
   * `load` but skips JSON.parse for callers that have already decoded.
   */
  static fromValue(value: unknown): DAG {
    return Validator.dag.validate(value);
  }

  /** Serialize a DAG to pretty JSON (2-space indent). */
  static serialize(dag: DAG): string {
    return JSON.stringify(dag, null, 2);
  }

  /** Serialize a DAG to compact JSON (no whitespace). */
  static serializeCompact(dag: DAG): string {
    return JSON.stringify(dag);
  }
}
