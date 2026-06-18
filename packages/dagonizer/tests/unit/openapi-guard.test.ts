/**
 * OpenApiGuard.assertShape: schema-backed narrowing at the tool HTTP boundary.
 *
 *  - A body satisfying the validator is returned narrowed to T.
 *  - A body failing the validator throws a non-retryable ToolError(PARSE_ERROR)
 *    whose message carries the supplied label and the validator's errors.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { OpenApiGuard } from '../../src/tool/OpenApiGuard.js';
import { ToolError } from '../../src/tool/ToolError.js';
import type { EntityValidator } from '../../src/validation/Validator.js';

interface Book { title: string }

/** Structural validator: a body is a Book when it carries a string `title`. */
const bookValidator: EntityValidator<Book> = {
  'is'(value): value is Book {
    return typeof value === 'object' && value !== null
      && 'title' in value && typeof (value as { title: unknown }).title === 'string';
  },
  'validate'(value): Book {
    if (this.is(value)) return value;
    throw new Error('invalid');
  },
  'errors'(value): string[] | null {
    return this.is(value) ? null : ['/title: must be a string'];
  },
};

void describe('OpenApiGuard.assertShape', () => {
  void it('returns the value narrowed to T on a valid body', () => {
    const raw: unknown = { 'title': 'Dune' };
    const book = OpenApiGuard.assertShape(raw, bookValidator, 'Book');
    assert.equal(book.title, 'Dune');
  });

  void it('throws a non-retryable ToolError(PARSE_ERROR) on an invalid body', () => {
    const raw: unknown = { 'name': 'no title here' };
    assert.throws(
      () => OpenApiGuard.assertShape(raw, bookValidator, 'GoogleBooksVolume'),
      (err: unknown): err is ToolError => {
        if (!(err instanceof ToolError)) return false;
        assert.equal(err.reason, 'PARSE_ERROR');
        assert.equal(err.retryable, false);
        assert.equal(err.status, null);
        assert.ok(err.message.includes('GoogleBooksVolume'), 'message carries the label');
        assert.ok(err.message.includes('/title'), 'message carries the validator errors');
        return true;
      },
    );
  });
});
