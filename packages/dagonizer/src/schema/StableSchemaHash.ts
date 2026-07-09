import { Hash } from '@studnicky/json';

import type { SchemaObjectType } from '../contracts/NodeInterface.js';

export class StableSchemaHash extends Hash {
  private constructor() { super(); }

  static of(schema: SchemaObjectType): string {
    return this.value(schema);
  }
}
