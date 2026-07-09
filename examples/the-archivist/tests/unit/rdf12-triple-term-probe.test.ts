import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { DataFactory, Store, Writer } from 'n3';
import type { DataFactory as RdfDataFactory, Quad, Quad_Object } from '@rdfjs/types';

const factory: RdfDataFactory = DataFactory;
const { namedNode, literal, quad } = factory;

function requireTripleTerm(term: Quad_Object): Quad {
  if (term.termType !== 'Quad') {
    assert.fail('expected RDF 1.2 triple term');
  }
  return term;
}

void test('N3 RDF 1.2 triple terms model a reifying DAG edge annotation', async () => {
  const asserted = quad(
    namedNode('urn:dagonizer:dag:edge:a-b'),
    namedNode('urn:dagonizer:dag:routes'),
    literal('success'),
  );
  const reifier = namedNode('urn:dagonizer:annotation:edge:a-b');
  const reifies = namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies');
  const annotation = quad(reifier, reifies, asserted);

  const tripleTerm = requireTripleTerm(annotation.object);
  assert.equal(tripleTerm.subject.value, 'urn:dagonizer:dag:edge:a-b');
  assert.equal(tripleTerm.predicate.value, 'urn:dagonizer:dag:routes');
  assert.equal(tripleTerm.object.value, 'success');

  const store = new Store([annotation]);
  const matches = [...store.readQuads(reifier, reifies, asserted, null)];
  assert.equal(matches.length, 1);

  const writer = new Writer({ 'format': 'N-Triples' });
  writer.addQuad(annotation);
  const serialized = await new Promise<string>((resolve, reject) => {
    writer.end((error, result) => {
      if (error !== null && error !== undefined) reject(error);
      else resolve(result);
    });
  });

  assert.ok(serialized.includes('<<('));
  assert.ok(serialized.includes('rdf-syntax-ns#reifies'));
});
