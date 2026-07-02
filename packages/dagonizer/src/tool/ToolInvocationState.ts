/**
 * ToolInvocationState: per-tool-invocation state container.
 *
 * Carries the raw tool-call arguments (`input`) into the embedded DAG and
 * the tool's return value (`output`) back out. Both fields are initialised
 * in the constructor in declaration order for V8 shape stability — every
 * instance has the same hidden class regardless of call site.
 *
 * Snapshot/restore covers both fields so the state survives checkpoint/resume.
 */

import { Predicates } from '@studnicky/predicates';

import type { JsonObjectType } from '../entities/json.js';
import { JsonValue } from '../entities/JsonValue.js';
import { NodeStateBase } from '../NodeStateBase.js';

export class ToolInvocationState extends NodeStateBase {
  /**
   * Arguments passed to the tool. Set before the embedded DAG runs. Typed
   * `JsonObjectType` because tool arguments are JSON (they cross the scatter /
   * checkpoint boundary) — so the snapshot needs no cast.
   */
  input: JsonObjectType;
  /**
   * Return value from the tool. Written by `ToolInvokeNode`. Genuinely
   * `unknown` — the registry erases each tool's concrete output type — so it is
   * narrowed to JSON via `JsonValue.from` at the snapshot boundary, not cast.
   */
  output: unknown;

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

  protected override snapshotData(): JsonObjectType {
    return {
      // `input` is already `JsonObjectType`; a shallow copy stays JSON-typed.
      'input':  { ...this.input },
      // `output` is genuinely `unknown` (generic tool return) — coerce to a real
      // `JsonValueType` field-wise rather than asserting it.
      'output': JsonValue.from(this.output),
    };
  }

  protected override restoreData(snapshot: JsonObjectType): void {
    const rawInput = snapshot['input'];
    // `rawInput` is `JsonValueType`; narrow to a JSON object before assigning.
    if (typeof rawInput === 'object' && rawInput !== null && !Array.isArray(rawInput)) {
      this.input = rawInput;
    }

    if ('output' in snapshot) {
      this.output = snapshot['output'];
    }
  }
}
