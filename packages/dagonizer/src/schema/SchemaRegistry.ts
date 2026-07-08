import type { SchemaObjectType } from '../contracts/NodeInterface.js';
import { DAGError } from '../errors/DAGError.js';

import { SchemaIdentity } from './SchemaIdentity.js';
import { StableSchemaHash } from './StableSchemaHash.js';

export class SchemaRegistry {
  readonly #schemas = new Map<string, SchemaObjectType>();

  register(schema: SchemaObjectType): string {
    const iri = SchemaIdentity.for(schema);
    const existing = this.#schemas.get(iri);
    if (existing !== undefined && StableSchemaHash.of(existing) !== StableSchemaHash.of(schema)) {
      throw new DAGError(`Schema IRI '${iri}' is already registered with a different body`);
    }
    this.#schemas.set(iri, schema);
    return iri;
  }

  get(iri: string): SchemaObjectType | undefined {
    return this.#schemas.get(iri);
  }

  has(iri: string): boolean {
    return this.#schemas.has(iri);
  }

  entries(): readonly (readonly [string, SchemaObjectType])[] {
    return [...this.#schemas.entries()];
  }
}
