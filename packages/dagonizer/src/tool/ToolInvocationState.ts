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

import type { JsonObjectType } from '../entities/json.js';
import { NodeStateBase } from '../NodeStateBase.js';

export class ToolInvocationState extends NodeStateBase {
  /** Arguments passed to the tool. Set before the embedded DAG runs. */
  input: Record<string, unknown>;
  /** Return value from the tool. Written by `ToolInvokeNode`. */
  output: unknown;

  constructor() {
    super();
    // Initialise in declaration order — keeps the hidden class stable.
    this.input = {};
    this.output = null;
  }

  protected override snapshotData(): JsonObjectType {
    return {
      // Shallow-copy; caller contract: `input` values are JSON-safe primitives/objects.
      // The cast is the single permitted ingest point — identical to `setMetadata`.
      'input':  { ...this.input } as JsonObjectType,
      // output may be any JSON-safe value. Cast as with `setMetadata` in NodeStateBase.
      'output': (this.output !== undefined ? this.output : null) as JsonObjectType[string],
    };
  }

  protected override restoreData(snapshot: JsonObjectType): void {
    const rawInput = snapshot['input'];
    if (
      rawInput !== undefined &&
      typeof rawInput === 'object' &&
      rawInput !== null &&
      !Array.isArray(rawInput)
    ) {
      this.input = rawInput as Record<string, unknown>;
    }

    if ('output' in snapshot) {
      this.output = snapshot['output'];
    }
  }
}
