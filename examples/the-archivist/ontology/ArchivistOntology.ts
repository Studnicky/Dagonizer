/**
 * ArchivistOntology: TBox (schema) for the Archivist's RDF memory.
 *
 * Defines the class and property vocabulary under the `dag:` namespace
 * (`https://noocodex.dev/ontology/dagonizer/`).  Every ABox write in
 * `recordFindings.ts` and `StateProjection.ts` uses these same IRIs so
 * SPARQL queries span the TBox (`urn:dagonizer:ontology`) and ABox
 * (`urn:dagonizer:memory`, `urn:dagonizer:state:<runId>`) uniformly.
 *
 * Exported surfaces:
 *   - `ArchivistOntologyJsonLd`: canonical JSON-LD document (docs / tooling)
 *   - `ONTOLOGY_NTRIPLES`:       N-Triples ready to load via `MemoryStore.loadOntology()`
 *
 * Classes (7):
 *   dag:Book, dag:Author, dag:Subject, dag:Run, dag:Activity,
 *   dag:Source, dag:Score
 *
 * Object properties (7):
 *   dag:hasAuthor, dag:hasSubject, dag:fromSource, dag:queriedIn,
 *   dag:shortlisted, dag:about, dag:publishedBy
 *
 * Datatype properties (9):
 *   dag:title, dag:isbn, dag:summary, dag:firstPublishYear,
 *   dag:rating, dag:score, dag:visitorQuery, dag:runTimestamp, dag:inShortlist
 *
 * Cross-source query surface (with TBox + ABox co-loaded):
 *   • JOIN on dag:title across catalog, web-search, wiki records (same predicate)
 *   • Enumerate all books from a Run:  ?run dag:candidate ?book
 *   • Rank by score across sources:    ?book dag:score ?s  ORDER BY DESC(?s)
 *   • Trace lineage:  ?run dag:queriedIn / dag:fromSource ?src
 *   • Schema reflection: ask what class/domain/range a predicate has
 */

/** @internal Namespace abbreviation. */
const DAG = 'https://noocodex.dev/ontology/dagonizer/';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const OWL  = 'http://www.w3.org/2002/07/owl#';
const XSD  = 'http://www.w3.org/2001/XMLSchema#';
const PROV = 'http://www.w3.org/ns/prov#';

// ── JSON-LD context ─────────────────────────────────────────────────────────

const CONTEXT = {
  '@vocab':    DAG,
  'dag':       DAG,
  'rdfs':      RDFS,
  'owl':       OWL,
  'xsd':       XSD,
  'prov':      PROV,
  'subClassOf':      { '@id': `${RDFS}subClassOf`,  '@type': '@id' },
  'domain':          { '@id': `${RDFS}domain`,       '@type': '@id' },
  'range':           { '@id': `${RDFS}range`,        '@type': '@id' },
  'label':           { '@id': `${RDFS}label`,        '@language': 'en' },
  'comment':         { '@id': `${RDFS}comment`,      '@language': 'en' },
  'type':            '@type',
  'Class':           `${OWL}Class`,
  'ObjectProperty':  `${OWL}ObjectProperty`,
  'DatatypeProperty': `${OWL}DatatypeProperty`,
  'Ontology':        `${OWL}Ontology`,
};

// ── JSON-LD document ────────────────────────────────────────────────────────

/** Canonical JSON-LD ontology document. Use for tooling, docs, and exports. */
export const ArchivistOntologyJsonLd: Record<string, unknown> = {
  '@context': CONTEXT,
  '@graph': [

    // Ontology header
    {
      '@id':     `${DAG}`,
      'type':    'Ontology',
      'label':   'Dagonizer Archivist Ontology',
      'comment': 'TBox vocabulary for the Archivist demo RDF memory store',
    },

    // ── Classes ────────────────────────────────────────────────────────────

    {
      '@id':   `${DAG}Book`,
      'type':  'Class',
      'label': 'Book',
      'comment': 'A bibliographic record: catalog entry, web-search result, or wiki article.',
    },
    {
      '@id':   `${DAG}Author`,
      'type':  'Class',
      'label': 'Author',
      'comment': 'A person or organisation responsible for a Book.',
    },
    {
      '@id':   `${DAG}Subject`,
      'type':  'Class',
      'label': 'Subject',
      'comment': 'A thematic topic or classification applied to a Book.',
    },
    {
      '@id':       `${DAG}Run`,
      'type':      'Class',
      'label':     'Run',
      'comment':   'One top-level Archivist execution, keyed by runId.',
      'subClassOf': `${PROV}Activity`,
    },
    {
      '@id':       `${DAG}Activity`,
      'type':      'Class',
      'label':     'Activity',
      'comment':   'An Archivist-domain prov:Activity (node execution, tool call, LLM call).',
      'subClassOf': `${PROV}Activity`,
    },
    {
      '@id':   `${DAG}Source`,
      'type':  'Class',
      'label': 'Source',
      'comment': 'A data source from which Book records are fetched (catalog, web, wiki, reviews).',
    },
    {
      '@id':   `${DAG}Score`,
      'type':  'Class',
      'label': 'Score',
      'comment': 'A ranked relevance score in [0, 1] assigned to a Book by the ranking node.',
    },

    // ── Object properties ──────────────────────────────────────────────────

    {
      '@id':    `${DAG}hasAuthor`,
      'type':   'ObjectProperty',
      'label':  'hasAuthor',
      'comment': 'Relates a Book to an Author.',
      'domain': `${DAG}Book`,
      'range':  `${DAG}Author`,
    },
    {
      '@id':    `${DAG}hasSubject`,
      'type':   'ObjectProperty',
      'label':  'hasSubject',
      'comment': 'Relates a Book to a Subject.',
      'domain': `${DAG}Book`,
      'range':  `${DAG}Subject`,
    },
    {
      '@id':    `${DAG}fromSource`,
      'type':   'ObjectProperty',
      'label':  'fromSource',
      'comment': 'Relates a Book record to the Source it was retrieved from.',
      'domain': `${DAG}Book`,
      'range':  `${DAG}Source`,
    },
    {
      '@id':    `${DAG}queriedIn`,
      'type':   'ObjectProperty',
      'label':  'queriedIn',
      'comment': 'Relates a Source to the Run it was consulted in.',
      'domain': `${DAG}Source`,
      'range':  `${DAG}Run`,
    },
    {
      '@id':    `${DAG}shortlisted`,
      'type':   'ObjectProperty',
      'label':  'shortlisted',
      'comment': 'Relates a Run to a Book that was placed on the shortlist.',
      'domain': `${DAG}Run`,
      'range':  `${DAG}Book`,
    },
    {
      '@id':    `${DAG}about`,
      'type':   'ObjectProperty',
      'label':  'about',
      'comment': 'Relates a Book to a Subject it is about.',
      'domain': `${DAG}Book`,
      'range':  `${DAG}Subject`,
    },
    {
      '@id':    `${DAG}publishedBy`,
      'type':   'ObjectProperty',
      'label':  'publishedBy',
      'comment': 'Relates a Book to its publisher (as a named node or literal).',
      'domain': `${DAG}Book`,
    },

    // ── Datatype properties ────────────────────────────────────────────────

    {
      '@id':    `${DAG}title`,
      'type':   'DatatypeProperty',
      'label':  'title',
      'comment': 'Human-readable title of a Book.',
      'domain': `${DAG}Book`,
      'range':  `${XSD}string`,
    },
    {
      '@id':    `${DAG}isbn`,
      'type':   'DatatypeProperty',
      'label':  'isbn',
      'comment': 'ISBN-13, ISBN-10, or opaque source key identifying a Book.',
      'domain': `${DAG}Book`,
      'range':  `${XSD}string`,
    },
    {
      '@id':    `${DAG}summary`,
      'type':   'DatatypeProperty',
      'label':  'summary',
      'comment': 'Editorial description or summary of a Book.',
      'domain': `${DAG}Book`,
      'range':  `${XSD}string`,
    },
    {
      '@id':    `${DAG}firstPublishYear`,
      'type':   'DatatypeProperty',
      'label':  'firstPublishYear',
      'comment': 'Year the Book was first published.',
      'domain': `${DAG}Book`,
      'range':  `${XSD}integer`,
    },
    {
      '@id':    `${DAG}rating`,
      'type':   'DatatypeProperty',
      'label':  'rating',
      'comment': 'Reader rating of a Book in [0, 5].',
      'domain': `${DAG}Book`,
      'range':  `${XSD}double`,
    },
    {
      '@id':    `${DAG}score`,
      'type':   'DatatypeProperty',
      'label':  'score',
      'comment': 'Relevance score in [0, 1] assigned to a Book for a given query.',
      'domain': `${DAG}Book`,
      'range':  `${XSD}double`,
    },
    {
      '@id':    `${DAG}visitorQuery`,
      'type':   'DatatypeProperty',
      'label':  'visitorQuery',
      'comment': 'Raw question string submitted by the visitor in a Run.',
      'domain': `${DAG}Run`,
      'range':  `${XSD}string`,
    },
    {
      '@id':    `${DAG}runTimestamp`,
      'type':   'DatatypeProperty',
      'label':  'runTimestamp',
      'comment': 'Unix timestamp (ms) when the Run was recorded.',
      'domain': `${DAG}Run`,
      'range':  `${XSD}double`,
    },
    {
      '@id':    `${DAG}inShortlist`,
      'type':   'DatatypeProperty',
      'label':  'inShortlist',
      'comment': 'True when a Book was selected onto the shortlist for the current Run.',
      'domain': `${DAG}Book`,
      'range':  `${XSD}boolean`,
    },
    {
      '@id':    `${DAG}source`,
      'type':   'DatatypeProperty',
      'label':  'source',
      'comment': 'String identifier of the source a Book record was retrieved from (e.g. "web-search").',
      'domain': `${DAG}Book`,
      'range':  `${XSD}string`,
    },
    {
      '@id':    `${DAG}author`,
      'type':   'DatatypeProperty',
      'label':  'author',
      'comment': 'String name of an author of a Book (literal form of hasAuthor).',
      'domain': `${DAG}Book`,
      'range':  `${XSD}string`,
    },
    {
      '@id':    `${DAG}subject`,
      'type':   'DatatypeProperty',
      'label':  'subject',
      'comment': 'String label of a subject/topic of a Book (literal form of hasSubject).',
      'domain': `${DAG}Book`,
      'range':  `${XSD}string`,
    },
    {
      '@id':    `${DAG}candidate`,
      'type':   'ObjectProperty',
      'label':  'candidate',
      'comment': 'Relates a Run to a Book that was a candidate in that run.',
      'domain': `${DAG}Run`,
      'range':  `${DAG}Book`,
    },
    {
      '@id':    `${DAG}shortlistedTitle`,
      'type':   'DatatypeProperty',
      'label':  'shortlistedTitle',
      'comment': 'Title string of a Book shortlisted in a Run (literal convenience predicate).',
      'domain': `${DAG}Run`,
      'range':  `${XSD}string`,
    },
  ],
};

// ── N-Triples serialisation ─────────────────────────────────────────────────
//
// Pre-baked so `MemoryStore.loadOntology()` can parse them without a
// JSON-LD library.  Generated once from the JSON-LD graph above; kept
// in sync manually (or via build tooling) since the ontology is stable.

function iri(s: string): string { return `<${s}>`; }
function lit(s: string): string { return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"@en`; }
function triple(s: string, p: string, o: string): string {
  return `${iri(s)} ${iri(p)} ${iri(o)} .`;
}
function tripleL(s: string, p: string, o: string): string {
  return `${iri(s)} ${iri(p)} ${lit(o)} .`;
}

const RDF_TYPE    = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const OWL_CLASS   = `${OWL}Class`;
const OWL_OP      = `${OWL}ObjectProperty`;
const OWL_DP      = `${OWL}DatatypeProperty`;
const RDFS_SUB    = `${RDFS}subClassOf`;
const RDFS_DOMAIN = `${RDFS}domain`;
const RDFS_RANGE  = `${RDFS}range`;
const RDFS_LABEL  = `${RDFS}label`;
const RDFS_COMMENT = `${RDFS}comment`;

/** N-Triple strings ready to load into the ontology named graph. */
export const ONTOLOGY_NTRIPLES: readonly string[] = [
  // ── Classes
  triple(`${DAG}Book`,     RDF_TYPE, OWL_CLASS),
  tripleL(`${DAG}Book`,    RDFS_LABEL,   'Book'),
  tripleL(`${DAG}Book`,    RDFS_COMMENT, 'A bibliographic record: catalog entry, web-search result, or wiki article.'),

  triple(`${DAG}Author`,   RDF_TYPE, OWL_CLASS),
  tripleL(`${DAG}Author`,  RDFS_LABEL,   'Author'),
  tripleL(`${DAG}Author`,  RDFS_COMMENT, 'A person or organisation responsible for a Book.'),

  triple(`${DAG}Subject`,  RDF_TYPE, OWL_CLASS),
  tripleL(`${DAG}Subject`, RDFS_LABEL,   'Subject'),
  tripleL(`${DAG}Subject`, RDFS_COMMENT, 'A thematic topic or classification applied to a Book.'),

  triple(`${DAG}Run`,      RDF_TYPE,  OWL_CLASS),
  triple(`${DAG}Run`,      RDFS_SUB,  `${PROV}Activity`),
  tripleL(`${DAG}Run`,     RDFS_LABEL,   'Run'),
  tripleL(`${DAG}Run`,     RDFS_COMMENT, 'One top-level Archivist execution, keyed by runId.'),

  triple(`${DAG}Activity`, RDF_TYPE, OWL_CLASS),
  triple(`${DAG}Activity`, RDFS_SUB, `${PROV}Activity`),
  tripleL(`${DAG}Activity`, RDFS_LABEL,   'Activity'),
  tripleL(`${DAG}Activity`, RDFS_COMMENT, 'An Archivist-domain prov:Activity (node execution, tool call, LLM call).'),

  triple(`${DAG}Source`,   RDF_TYPE, OWL_CLASS),
  tripleL(`${DAG}Source`,  RDFS_LABEL,   'Source'),
  tripleL(`${DAG}Source`,  RDFS_COMMENT, 'A data source from which Book records are fetched (catalog, web, wiki, reviews).'),

  triple(`${DAG}Score`,    RDF_TYPE, OWL_CLASS),
  tripleL(`${DAG}Score`,   RDFS_LABEL,   'Score'),
  tripleL(`${DAG}Score`,   RDFS_COMMENT, 'A ranked relevance score in [0, 1] assigned to a Book by the ranking node.'),

  // ── Object properties
  triple(`${DAG}hasAuthor`,   RDF_TYPE,    OWL_OP),
  triple(`${DAG}hasAuthor`,   RDFS_DOMAIN, `${DAG}Book`),
  triple(`${DAG}hasAuthor`,   RDFS_RANGE,  `${DAG}Author`),
  tripleL(`${DAG}hasAuthor`,  RDFS_LABEL,  'hasAuthor'),

  triple(`${DAG}hasSubject`,  RDF_TYPE,    OWL_OP),
  triple(`${DAG}hasSubject`,  RDFS_DOMAIN, `${DAG}Book`),
  triple(`${DAG}hasSubject`,  RDFS_RANGE,  `${DAG}Subject`),
  tripleL(`${DAG}hasSubject`, RDFS_LABEL,  'hasSubject'),

  triple(`${DAG}fromSource`,  RDF_TYPE,    OWL_OP),
  triple(`${DAG}fromSource`,  RDFS_DOMAIN, `${DAG}Book`),
  triple(`${DAG}fromSource`,  RDFS_RANGE,  `${DAG}Source`),
  tripleL(`${DAG}fromSource`, RDFS_LABEL,  'fromSource'),

  triple(`${DAG}queriedIn`,   RDF_TYPE,    OWL_OP),
  triple(`${DAG}queriedIn`,   RDFS_DOMAIN, `${DAG}Source`),
  triple(`${DAG}queriedIn`,   RDFS_RANGE,  `${DAG}Run`),
  tripleL(`${DAG}queriedIn`,  RDFS_LABEL,  'queriedIn'),

  triple(`${DAG}shortlisted`, RDF_TYPE,    OWL_OP),
  triple(`${DAG}shortlisted`, RDFS_DOMAIN, `${DAG}Run`),
  triple(`${DAG}shortlisted`, RDFS_RANGE,  `${DAG}Book`),
  tripleL(`${DAG}shortlisted`, RDFS_LABEL, 'shortlisted'),

  triple(`${DAG}about`,       RDF_TYPE,    OWL_OP),
  triple(`${DAG}about`,       RDFS_DOMAIN, `${DAG}Book`),
  triple(`${DAG}about`,       RDFS_RANGE,  `${DAG}Subject`),
  tripleL(`${DAG}about`,      RDFS_LABEL,  'about'),

  triple(`${DAG}publishedBy`, RDF_TYPE,    OWL_OP),
  triple(`${DAG}publishedBy`, RDFS_DOMAIN, `${DAG}Book`),
  tripleL(`${DAG}publishedBy`, RDFS_LABEL, 'publishedBy'),

  // ── Datatype properties
  triple(`${DAG}title`,            RDF_TYPE,    OWL_DP),
  triple(`${DAG}title`,            RDFS_DOMAIN, `${DAG}Book`),
  triple(`${DAG}title`,            RDFS_RANGE,  `${XSD}string`),
  tripleL(`${DAG}title`,           RDFS_LABEL,  'title'),

  triple(`${DAG}isbn`,             RDF_TYPE,    OWL_DP),
  triple(`${DAG}isbn`,             RDFS_DOMAIN, `${DAG}Book`),
  triple(`${DAG}isbn`,             RDFS_RANGE,  `${XSD}string`),
  tripleL(`${DAG}isbn`,            RDFS_LABEL,  'isbn'),

  triple(`${DAG}summary`,          RDF_TYPE,    OWL_DP),
  triple(`${DAG}summary`,          RDFS_DOMAIN, `${DAG}Book`),
  triple(`${DAG}summary`,          RDFS_RANGE,  `${XSD}string`),
  tripleL(`${DAG}summary`,         RDFS_LABEL,  'summary'),

  triple(`${DAG}firstPublishYear`, RDF_TYPE,    OWL_DP),
  triple(`${DAG}firstPublishYear`, RDFS_DOMAIN, `${DAG}Book`),
  triple(`${DAG}firstPublishYear`, RDFS_RANGE,  `${XSD}integer`),
  tripleL(`${DAG}firstPublishYear`, RDFS_LABEL, 'firstPublishYear'),

  triple(`${DAG}rating`,           RDF_TYPE,    OWL_DP),
  triple(`${DAG}rating`,           RDFS_DOMAIN, `${DAG}Book`),
  triple(`${DAG}rating`,           RDFS_RANGE,  `${XSD}double`),
  tripleL(`${DAG}rating`,          RDFS_LABEL,  'rating'),

  triple(`${DAG}score`,            RDF_TYPE,    OWL_DP),
  triple(`${DAG}score`,            RDFS_DOMAIN, `${DAG}Book`),
  triple(`${DAG}score`,            RDFS_RANGE,  `${XSD}double`),
  tripleL(`${DAG}score`,           RDFS_LABEL,  'score'),

  triple(`${DAG}visitorQuery`,     RDF_TYPE,    OWL_DP),
  triple(`${DAG}visitorQuery`,     RDFS_DOMAIN, `${DAG}Run`),
  triple(`${DAG}visitorQuery`,     RDFS_RANGE,  `${XSD}string`),
  tripleL(`${DAG}visitorQuery`,    RDFS_LABEL,  'visitorQuery'),

  triple(`${DAG}runTimestamp`,     RDF_TYPE,    OWL_DP),
  triple(`${DAG}runTimestamp`,     RDFS_DOMAIN, `${DAG}Run`),
  triple(`${DAG}runTimestamp`,     RDFS_RANGE,  `${XSD}double`),
  tripleL(`${DAG}runTimestamp`,    RDFS_LABEL,  'runTimestamp'),

  triple(`${DAG}inShortlist`,      RDF_TYPE,    OWL_DP),
  triple(`${DAG}inShortlist`,      RDFS_DOMAIN, `${DAG}Book`),
  triple(`${DAG}inShortlist`,      RDFS_RANGE,  `${XSD}boolean`),
  tripleL(`${DAG}inShortlist`,     RDFS_LABEL,  'inShortlist'),

  triple(`${DAG}source`,           RDF_TYPE,    OWL_DP),
  triple(`${DAG}source`,           RDFS_DOMAIN, `${DAG}Book`),
  triple(`${DAG}source`,           RDFS_RANGE,  `${XSD}string`),
  tripleL(`${DAG}source`,          RDFS_LABEL,  'source'),

  triple(`${DAG}author`,           RDF_TYPE,    OWL_DP),
  triple(`${DAG}author`,           RDFS_DOMAIN, `${DAG}Book`),
  triple(`${DAG}author`,           RDFS_RANGE,  `${XSD}string`),
  tripleL(`${DAG}author`,          RDFS_LABEL,  'author'),

  triple(`${DAG}subject`,          RDF_TYPE,    OWL_DP),
  triple(`${DAG}subject`,          RDFS_DOMAIN, `${DAG}Book`),
  triple(`${DAG}subject`,          RDFS_RANGE,  `${XSD}string`),
  tripleL(`${DAG}subject`,         RDFS_LABEL,  'subject'),

  triple(`${DAG}candidate`,        RDF_TYPE,    OWL_OP),
  triple(`${DAG}candidate`,        RDFS_DOMAIN, `${DAG}Run`),
  triple(`${DAG}candidate`,        RDFS_RANGE,  `${DAG}Book`),
  tripleL(`${DAG}candidate`,       RDFS_LABEL,  'candidate'),

  triple(`${DAG}shortlistedTitle`, RDF_TYPE,    OWL_DP),
  triple(`${DAG}shortlistedTitle`, RDFS_DOMAIN, `${DAG}Run`),
  triple(`${DAG}shortlistedTitle`, RDFS_RANGE,  `${XSD}string`),
  tripleL(`${DAG}shortlistedTitle`, RDFS_LABEL, 'shortlistedTitle'),
];
