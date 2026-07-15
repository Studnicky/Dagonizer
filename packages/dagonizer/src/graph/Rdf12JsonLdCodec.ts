import type { Quad } from '@rdfjs/types';
import { JsonLdParser } from 'jsonld-streaming-parser';
import { JsonLdSerializer } from 'jsonld-streaming-serializer';

type JsonLdInput = object | string;
type ParserOptions = NonNullable<ConstructorParameters<typeof JsonLdParser>[0]>;
type SerializerOptions = NonNullable<ConstructorParameters<typeof JsonLdSerializer>[0]>;
type ParseOptions = Pick<ParserOptions, 'baseIRI' | 'context' | 'defaultGraph' | 'rdfstar' | 'streamingProfile' | 'strictValues'>;
type SerializeOptions = Pick<SerializerOptions, 'baseIRI' | 'compactIds' | 'context' | 'excludeContext' | 'space' | 'useNativeTypes' | 'useRdfType'>;

/** The single RDF 1.2 JSON-LD-star parser/serializer boundary. */
export class Rdf12JsonLdCodec {
  private constructor() { /* static-only */ }

  static parse(input: JsonLdInput, options: ParseOptions = {}): Promise<readonly Quad[]> {
    const parser = new JsonLdParser({ 'rdfstar': true, ...options });
    const source = typeof input === 'string' ? input : JSON.stringify(input);
    const quads: Quad[] = [];

    return new Promise<readonly Quad[]>((resolve, reject) => {
      parser.on('data', (quad: Quad) => quads.push(quad));
      parser.on('error', reject);
      parser.on('end', () => {
        try {
          for (const quad of quads) Rdf12JsonLdCodec.validateQuad(quad);
          resolve(quads);
        } catch (error) {
          reject(error);
        }
      });
      parser.end(source);
    });
  }

  static serialize(quads: Iterable<Quad>, options: SerializeOptions = {}): Promise<string> {
    const source = [...quads];
    if (options.context !== undefined && source.some(Rdf12JsonLdCodec.containsTripleTerm)) {
      return Promise.reject(new Error('RDF 1.2 JSON-LD serialization with a context is not lossless for triple terms'));
    }
    const serializer = new JsonLdSerializer(options);
    const chunks: string[] = [];

    return new Promise<string>((resolve, reject) => {
      serializer.on('data', (chunk: Buffer | string) => {
        chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      });
      serializer.on('error', reject);
      serializer.on('end', () => resolve(chunks.join('')));
      for (const quad of source) {
        try {
          Rdf12JsonLdCodec.validateQuad(quad);
          serializer.write(quad);
        } catch (error) {
          reject(error);
          return;
        }
      }
      serializer.end();
    });
  }

  private static validateQuad(quad: Quad): void {
    if (Rdf12JsonLdCodec.isTripleTerm(quad.subject)) {
      throw new Error('RDF 1.2 JSON-LD requires triple terms in object position');
    }
    if (Rdf12JsonLdCodec.isTripleTerm(quad.predicate) || Rdf12JsonLdCodec.isTripleTerm(quad.graph)) {
      throw new Error('RDF 1.2 JSON-LD does not permit triple terms in predicate or graph position');
    }
  }

  private static containsTripleTerm(quad: Quad): boolean {
    return Rdf12JsonLdCodec.isTripleTerm(quad.subject)
      || Rdf12JsonLdCodec.isTripleTerm(quad.predicate)
      || Rdf12JsonLdCodec.isTripleTerm(quad.object)
      || Rdf12JsonLdCodec.isTripleTerm(quad.graph);
  }

  private static isTripleTerm(term: { termType: string }): boolean {
    return term.termType === 'Quad';
  }
}
