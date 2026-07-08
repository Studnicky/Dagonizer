import type { SchemaObjectType } from '../contracts/NodeInterface.js';

import { StableSchemaHash } from './StableSchemaHash.js';

export class SchemaIdentity {
  private constructor() { /* static-only */ }

  static for(schema: SchemaObjectType): string {
    const id = Reflect.get(schema, '$id');
    if (typeof id === 'string' && id.length > 0) return id;
    return `urn:dagonizer:schema:sha256:${StableSchemaHash.of(schema)}`;
  }
}
