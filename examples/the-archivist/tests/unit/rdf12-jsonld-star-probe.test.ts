import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { Rdf12JsonLdCodec as Rdf12JsonLd } from '@studnicky/dagonizer';
import type { Quad, Quad_Object, Quad_Subject } from '@rdfjs/types';

const RDF_REIFIES = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies';
const XSD_DECIMAL = 'http://www.w3.org/2001/XMLSchema#decimal';
const DAG_ANNOTATION_EDGE_A_B = 'https://dagonizer.dev/id/annotation/edge-a-b';
const DAG_EDGE_A_B = 'https://dagonizer.dev/id/edge/a-b';
const DAG_EDGE_B_C = 'https://dagonizer.dev/id/edge/b-c';
const DAG_PLANNER = 'https://dagonizer.dev/id/planner';
const DAG_ROUTES = 'https://dagonizer.dev/vocab#routes';
const DAG_CONFIDENCE = 'https://dagonizer.dev/vocab#confidence';
const DAG_SOURCE = 'https://dagonizer.dev/vocab#source';

const JSONLD_STAR_CONTEXT = {
  '@vocab': 'https://dagonizer.dev/vocab#',
  'rdf': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  'routes': { '@id': DAG_ROUTES, '@type': '@id' },
  'confidence': { '@id': DAG_CONFIDENCE },
  'source': { '@id': DAG_SOURCE, '@type': '@id' },
};

const JSONLD_RDF12_REIFIER = {
  '@context': JSONLD_STAR_CONTEXT,
  '@id': DAG_ANNOTATION_EDGE_A_B,
  'rdf:reifies': {
    '@id': {
      '@id': DAG_EDGE_A_B,
      'routes': { '@id': DAG_EDGE_B_C },
    },
  },
  'confidence': { '@value': '0.97', '@type': XSD_DECIMAL },
  'source': { '@id': DAG_PLANNER },
};

const JSONLD_STAR_EDGE = {
  '@context': JSONLD_STAR_CONTEXT,
  '@id': DAG_EDGE_A_B,
  'routes': {
    '@id': DAG_EDGE_B_C,
    '@annotation': {
      'confidence': { '@value': '0.97', '@type': XSD_DECIMAL },
      'source': { '@id': DAG_PLANNER },
    },
  },
};

function requireQuad(quad: Quad | undefined): Quad {
  if (quad === undefined) {
    assert.fail('expected RDF quad');
  }
  return quad;
}

function requireTripleTerm(term: Quad_Subject | Quad_Object): Quad {
  if (term.termType !== 'Quad') {
    assert.fail('expected RDF 1.2 triple term');
  }
  return term;
}

function findPredicate(quads: readonly Quad[], predicate: string): Quad {
  return requireQuad(quads.find((q) => q.predicate.value === predicate));
}

function assertRouteTripleTerm(term: Quad_Subject | Quad_Object): void {
  const route = requireTripleTerm(term);
  assert.equal(route.subject.value, DAG_EDGE_A_B);
  assert.equal(route.predicate.value, DAG_ROUTES);
  assert.equal(route.object.value, DAG_EDGE_B_C);
}

void test('JSON-LD-star parser maps RDF 1.2 reifier nodes to rdf:reifies triple-term objects', async () => {
  const quads = await Rdf12JsonLd.parse(JSONLD_RDF12_REIFIER);

  assert.equal(quads.length, 3);

  const reification = findPredicate(quads, RDF_REIFIES);
  assert.equal(reification.subject.value, DAG_ANNOTATION_EDGE_A_B);
  assertRouteTripleTerm(reification.object);

  const confidence = findPredicate(quads, DAG_CONFIDENCE);
  assert.equal(confidence.subject.value, DAG_ANNOTATION_EDGE_A_B);
  if (confidence.object.termType !== 'Literal') {
    assert.fail('expected confidence literal');
  }
  assert.equal(confidence.object.value, '0.97');
  assert.equal(confidence.object.datatype.value, XSD_DECIMAL);

  const source = findPredicate(quads, DAG_SOURCE);
  assert.equal(source.subject.value, DAG_ANNOTATION_EDGE_A_B);
  assert.equal(source.object.value, DAG_PLANNER);
  assert.equal(quads.some((quad) => quad.predicate.value === DAG_ROUTES), false);
});

void test('JSON-LD-star parser rejects @annotation shorthand with triple-term subjects', async () => {
  await assert.rejects(Rdf12JsonLd.parse(JSONLD_STAR_EDGE), /triple terms in object position/u);
});

void test('JSON-LD-star serializer keeps RDF/JS reifier annotations round-trippable', async () => {
  const quads = await Rdf12JsonLd.parse(JSONLD_RDF12_REIFIER);
  const serialized = await Rdf12JsonLd.serialize(quads, { 'space': '  ' });

  assert.ok(serialized.includes('"@id"'));
  assert.ok(serialized.includes(DAG_EDGE_A_B));
  assert.ok(serialized.includes(DAG_ROUTES));

  const reparsed = await Rdf12JsonLd.parse(serialized);
  const confidence = findPredicate(reparsed, DAG_CONFIDENCE);
  const source = findPredicate(reparsed, DAG_SOURCE);
  assert.equal(confidence.subject.value, DAG_ANNOTATION_EDGE_A_B);
  assert.equal(source.subject.value, DAG_ANNOTATION_EDGE_A_B);
});

void test('JSON-LD-star serializer rejects context compaction when triple terms are present', async () => {
  const quads = await Rdf12JsonLd.parse(JSONLD_RDF12_REIFIER);
  await assert.rejects(
    Rdf12JsonLd.serialize(quads, { 'context': JSONLD_STAR_CONTEXT }),
    /not lossless for triple terms/u,
  );
});
