import { JsonLdParser } from 'jsonld-streaming-parser';
import { JsonLdSerializer } from 'jsonld-streaming-serializer';
import type { Quad } from '@rdfjs/types';

type JsonLdInput = object | string;
type ParserOptions = NonNullable<ConstructorParameters<typeof JsonLdParser>[0]>;
type SerializerOptions = NonNullable<ConstructorParameters<typeof JsonLdSerializer>[0]>;
type ParseOptions = Pick<ParserOptions, 'baseIRI' | 'context' | 'defaultGraph' | 'rdfstar' | 'streamingProfile' | 'strictValues'>;
type SerializeOptions = Pick<SerializerOptions, 'baseIRI' | 'compactIds' | 'context' | 'excludeContext' | 'space' | 'useNativeTypes' | 'useRdfType'>;

export class Rdf12JsonLd {
  static parse(input: JsonLdInput, options: ParseOptions = {}): Promise<readonly Quad[]> {
    const parser = new JsonLdParser({ 'rdfstar': true, ...options });
    const source = typeof input === 'string' ? input : JSON.stringify(input);
    const quads: Quad[] = [];

    return new Promise<readonly Quad[]>((resolve, reject) => {
      parser.on('data', (quad: Quad) => quads.push(quad));
      parser.on('error', reject);
      parser.on('end', () => resolve(quads));
      parser.end(source);
    });
  }

  static serialize(quads: Iterable<Quad>, options: SerializeOptions = {}): Promise<string> {
    const serializer = new JsonLdSerializer(options);
    const chunks: string[] = [];

    return new Promise<string>((resolve, reject) => {
      serializer.on('data', (chunk: Buffer | string) => {
        chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      });
      serializer.on('error', reject);
      serializer.on('end', () => resolve(chunks.join('')));
      for (const q of quads) serializer.write(q);
      serializer.end();
    });
  }
}
