/**
 * ToolInvocationState: per-tool-invocation state container.
 *
 * Carries the raw tool-call arguments (`input`) into the embedded DAG and
 * the tool's return value (`output`) back out. Both fields are initialised
 * in the constructor in declaration order for V8 shape stability — every
 * instance has the same hidden class regardless of call site.
 *
 * Both fields are stored directly in the run graph and therefore survive
 * checkpoint, transfer, and resume.
 */

import { Predicates } from '@studnicky/predicates';

import type { JsonObjectType } from '../entities/json.js';
import { NodeStateBase } from '../NodeStateBase.js';

export class ToolInvocationState extends NodeStateBase {
  /**
   * Arguments passed to the tool. Set before the embedded DAG runs. Typed
   * `JsonObjectType` because tool arguments are JSON (they cross the scatter /
   * checkpoint boundary) — so the snapshot needs no cast.
   */
  get input(): JsonObjectType {
    const value = this.getGraphStateField('input');
    return value !== undefined && typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
  }

  set input(value: JsonObjectType) {
    this.setGraphStateField('input', value);
  }
  /**
   * Return value from the tool. Written by `ToolInvokeNode`. Genuinely
   * `unknown` — the registry erases each tool's concrete output type — so it is
   * narrowed to JSON via `JsonValue.from` at the snapshot boundary, not cast.
   */
  get output(): unknown {
    return this.getGraphStateField('output') ?? null;
  }

  set output(value: unknown) {
    this.setGraphStateField('output', value);
  }

  constructor() {
    super();
    // Initialise in declaration order — keeps the hidden class stable.
    this.input = {};
    this.output = null;
  }

  /**
   * Type guard: narrows an `unknown` value (a metadata entry or a snapshot
   * field) to a plain string-keyed record. A trusted predicate — no cast at the
   * call site.
   */
  static isArgumentRecord(value: unknown): value is Record<string, unknown> {
    return Predicates.matchesType('object', value);
  }

}
