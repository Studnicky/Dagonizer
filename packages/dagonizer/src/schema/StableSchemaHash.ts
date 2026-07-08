import { createHash } from 'node:crypto';

import type { SchemaObjectType } from '../contracts/NodeInterface.js';

export class StableSchemaHash {
  private constructor() { /* static-only */ }

  static of(schema: SchemaObjectType): string {
    return createHash('sha256')
      .update(stableStringify(schema))
      .digest('hex');
  }
}

function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
