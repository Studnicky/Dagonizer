/**
 * OpenApiGuard: shared schema-backed shape guard for HTTP-backed tools.
 *
 * Tools fetch a JSON body at a foreign boundary (`HttpTransport.getJson`
 * returns `unknown`) and must narrow it to their expected wire shape before
 * typed access. `OpenApiGuard.assertShape` performs that narrowing through a
 * module-load-compiled `EntityValidator` — never a hand-written predicate —
 * and throws a non-retryable `ToolError(PARSE_ERROR)` when the body does not
 * satisfy the schema. The `label` names the shape in the thrown message so a
 * failed assertion is diagnosable.
 *
 * Static class per project standards (`noun.verb()`). No constructor, no
 * instance state. Lives beside `Tool`, `HttpTransport`, and `ToolError` on
 * the `./tool` surface so the HTTP tools (googlebooks, openlibrary, …) import
 * one canonical guard rather than triplicating their own.
 */

import type { EntityValidator } from '../validation/Validator.js';

import { ToolError } from './ToolError.js';

export class OpenApiGuard {
  private constructor() { /* static class */ }

  /**
   * Validate `value` against a compiled `EntityValidator` and return it
   * narrowed to `T`. Throws a non-retryable `ToolError` with a
   * `PARSE_ERROR` reason when the value does not satisfy the schema; the
   * thrown message includes `label` and the formatted validator errors.
   */
  static assertShape<T>(value: unknown, validator: EntityValidator<T>, label: string): T {
    if (validator.is(value)) return value;
    const failures = validator.errors(value) ?? [];
    throw new ToolError(
      `${label}: response body schema violation:\n  - ${failures.join('\n  - ')}`,
      { 'reason': 'PARSE_ERROR', 'retryable': false, 'status': null },
    );
  }
}
