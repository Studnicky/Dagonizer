/**
 * SeedLibrary: 18-book sci-fi + philosophy seed for the Archivist's
 * memory graph.
 *
 * Loaded into `urn:dagonizer:memory` on mount so the Memory tab has
 * content from first paint.
 *
 * All ISBNs are ISBN-13, search-engine-verifiable. Subjects are
 * lowercase with hyphens.
 */

import { GRAPH_MEMORY, MemoryStore } from '../memory/MemoryStore.js';

const RDF_TYPE = MemoryStore.iri('http://www.w3.org/1999/02/22-rdf-syntax-ns#type');
const DAG_BOOK = MemoryStore.dagIri('Book');

export interface SeedBook {
  readonly isbn: string;
  readonly title: string;
  readonly authors: readonly string[];
  readonly firstPublishYear: number;
  readonly subjects: readonly string[];
  readonly summary: string;
}

export const SEED_BOOKS: readonly SeedBook[] = [
  // ── Science fiction ──────────────────────────────────────────────────────

  {
    'isbn':             '978-0765377067',
    'title':            'The Three-Body Problem',
    'authors':          ['Liu Cixin'],
    'firstPublishYear': 2014,
    'subjects':         ['physics', 'first-contact', 'chinese-literature', 'game-theory', 'scientism', 'virtual-reality'],
    'summary':          'During China\'s Cultural Revolution a secret military project makes contact with a dying alien civilisation, setting off a chain of events that threatens humanity\'s survival. Liu Cixin weaves quantum physics, game theory, and a harrowing look at scientific idealism into an epic of first contact.',
  },
  {
    'isbn':             '978-0441569595',
    'title':            'Neuromancer',
    'authors':          ['William Gibson'],
    'firstPublishYear': 1984,
    'subjects':         ['cyberpunk', 'artificial-intelligence', 'cyberspace', 'hacking', 'corporate-dystopia'],
    'summary':          'Burned-out console cowboy Case is hired for one last run in the matrix by a mysterious employer who wants to unleash a powerful AI. Gibson\'s debut novel coined the term "cyberspace" and defined the cyberpunk genre.',
  },
  {
    'isbn':             '978-0061054884',
    'title':            'The Dispossessed',
    'authors':          ['Ursula K. Le Guin'],
    'firstPublishYear': 1974,
    'subjects':         ['anarchism', 'utopia', 'physics', 'dual-world', 'political-philosophy', 'social-critique'],
    'summary':          'A physicist from an anarchist moon travels to the capitalist home world and must reconcile the contradictions of both societies. Le Guin\'s ambiguous utopia interrogates freedom, ownership, and the cost of idealism.',
  },
  {
    'isbn':             '978-0156027601',
    'title':            'Solaris',
    'authors':          ['Stanisław Lem'],
    'firstPublishYear': 1961,
    'subjects':         ['alien-intelligence', 'consciousness', 'epistemology', 'ocean-planet', 'psychological-horror'],
    'summary':          'Scientists stationed above a vast living ocean on Solaris find the planet projecting uncanny physical manifestations of their deepest memories. Lem\'s masterwork questions whether humanity can ever truly understand a non-human mind.',
  },
  {
    'isbn':             '978-1101972120',
    'title':            'Stories of Your Life and Others',
    'authors':          ['Ted Chiang'],
    'firstPublishYear': 2002,
    'subjects':         ['linguistics', 'determinism', 'mathematics', 'epistemology', 'hard-science-fiction', 'philosophy-of-language'],
    'summary':          'Eight stories that remake familiar concepts (language, mathematics, free will) through scrupulously rigorous scientific premises. The title story, basis for the film Arrival, explores how learning an alien grammar rewires human perception of time.',
  },
  {
    'isbn':             '978-0374104092',
    'title':            'Annihilation',
    'authors':          ['Jeff VanderMeer'],
    'firstPublishYear': 2014,
    'subjects':         ['ecological-horror', 'weird-fiction', 'exploration', 'identity', 'memory', 'uncanny'],
    'summary':          'A four-woman expedition enters the forbidden Area X and finds their journals, their memories, and their identities dissolving into the landscape. VanderMeer\'s first Southern Reach novel is a masterclass in dread built from what is left unsaid.',
  },
  {
    'isbn':             '978-0441478125',
    'title':            'The Left Hand of Darkness',
    'authors':          ['Ursula K. Le Guin'],
    'firstPublishYear': 1969,
    'subjects':         ['gender', 'anthropology', 'politics', 'winter-world', 'exile', 'otherness'],
    'summary':          'A human envoy arrives on a world where the inhabitants have no fixed gender and must navigate its icy politics alone to prevent a war. Le Guin\'s Hainish Cycle novel remains the definitive science-fiction meditation on gender and empathy.',
  },
  {
    'isbn':             '978-0553283686',
    'title':            'Hyperion',
    'authors':          ['Dan Simmons'],
    'firstPublishYear': 1989,
    'subjects':         ['far-future', 'pilgrimage', 'artificial-intelligence', 'time-travel', 'poetry', 'canterbury-tales'],
    'summary':          'Seven pilgrims journey to the Time Tombs on Hyperion, each telling their story on the way. Each story is a different genre: horror, spy thriller, detective, pastoral. Simmons binds them with Keats and the threat of the Shrike.',
  },
  {
    'isbn':             '978-0812515282',
    'title':            'A Fire Upon the Deep',
    'authors':          ['Vernor Vinge'],
    'firstPublishYear': 1992,
    'subjects':         ['space-opera', 'alien-intelligence', 'galactic-zones', 'civilisation-collapse', 'networked-minds'],
    'summary':          'The galaxy is divided into Zones of Thought where different levels of intelligence are possible, and a malevolent Power has been accidentally released from the Transcend. Vinge\'s space opera invents memorable non-human intelligences and asks what civilisation means at cosmic scale.',
  },
  {
    'isbn':             '978-1613743959',
    'title':            'Roadside Picnic',
    'authors':          ['Arkady Strugatsky', 'Boris Strugatsky'],
    'firstPublishYear': 1972,
    'subjects':         ['alien-artifacts', 'zone', 'stalker', 'post-contact', 'working-class', 'dystopia'],
    'summary':          'Alien visitors have left behind six Zones scattered with incomprehensible artifacts that are changing human society in unpredictable ways. The Strugatskys\' noir masterpiece asks what humanity does with gifts it cannot understand.',
  },

  // ── Philosophy / philosophical literature ─────────────────────────────────

  {
    'isbn':             '978-0811216999',
    'title':            'Labyrinths',
    'authors':          ['Jorge Luis Borges'],
    'firstPublishYear': 1962,
    'subjects':         ['labyrinth', 'library', 'infinity', 'metafiction', 'magical-realism', 'philosophy-of-mind'],
    'summary':          'A collection of Borges\'s most celebrated fictions and essays, including The Garden of Forking Paths, The Library of Babel, and Tlön, Uqbar, Orbis Tertius. Every story is a puzzle box about knowledge, time, and the architecture of reality.',
  },
  {
    'isbn':             '978-0486404455',
    'title':            'Tractatus Logico-Philosophicus',
    'authors':          ['Ludwig Wittgenstein'],
    'firstPublishYear': 1921,
    'subjects':         ['logic', 'language', 'philosophy-of-language', 'logical-atomism', 'limits-of-thought'],
    'summary':          'Wittgenstein\'s early masterwork proposes that the limits of language are the limits of the world, and that philosophical problems arise from misuse of language. The final proposition, "What we cannot speak about we must pass over in silence," remains one of philosophy\'s most quoted sentences.',
  },
  {
    'isbn':             '978-0525564454',
    'title':            'The Myth of Sisyphus',
    'authors':          ['Albert Camus'],
    'firstPublishYear': 1942,
    'subjects':         ['absurdism', 'existentialism', 'meaning', 'suicide', 'revolt', 'freedom'],
    'summary':          'Camus argues that life is absurd (meaningless and yet irresistibly demanding meaning) and that the only honest response is revolt, not despair. He ends by imagining Sisyphus happy, pushing his boulder forever without illusion.',
  },
  {
    'isbn':             '978-0679752554',
    'title':            'Discipline and Punish',
    'authors':          ['Michel Foucault'],
    'firstPublishYear': 1975,
    'subjects':         ['power', 'surveillance', 'prison', 'discipline', 'biopolitics', 'social-control'],
    'summary':          'Foucault traces the shift from public torture to the modern prison and argues that disciplinary power, embodied in the Panopticon, now structures schools, hospitals, and workplaces. A genealogy of surveillance and the modern subject.',
  },
  {
    'isbn':             '978-0231081597',
    'title':            'Difference and Repetition',
    'authors':          ['Gilles Deleuze'],
    'firstPublishYear': 1968,
    'subjects':         ['ontology', 'difference', 'repetition', 'identity', 'post-structuralism', 'immanence'],
    'summary':          'Deleuze argues that difference is primary, not derived from identity, and that repetition is never the return of the same but the production of the new. A difficult and rewarding dismantling of representational thinking.',
  },
  {
    'isbn':             '978-0465026562',
    'title':            'Gödel, Escher, Bach',
    'authors':          ['Douglas Hofstadter'],
    'firstPublishYear': 1979,
    'subjects':         ['self-reference', 'consciousness', 'mathematics', 'logic', 'music', 'artificial-intelligence'],
    'summary':          'Hofstadter weaves Gödel\'s incompleteness theorems, Bach\'s canons, and Escher\'s impossible figures into a meditation on consciousness, self-reference, and what it means for a system to perceive itself. A Pulitzer-winning exploration of strange loops.',
  },
  {
    'isbn':             '978-0140449334',
    'title':            'Meditations',
    'authors':          ['Marcus Aurelius'],
    'firstPublishYear': 180,
    'subjects':         ['stoicism', 'ethics', 'self-discipline', 'mortality', 'duty', 'personal-journal'],
    'summary':          'Private notes the Roman emperor wrote to himself as exercises in Stoic philosophy, covering impermanence, duty, the smallness of the self, and the indifference of the cosmos. Remarkably intimate for a document never intended to be published.',
  },
  {
    'isbn':             '978-0198245971',
    'title':            'The Phenomenology of Spirit',
    'authors':          ['G.W.F. Hegel'],
    'firstPublishYear': 1807,
    'subjects':         ['dialectic', 'consciousness', 'spirit', 'history', 'idealism', 'self-consciousness'],
    'summary':          'Hegel traces the journey of consciousness from sense-certainty through the dialectic of lordship and bondage to Absolute Knowing. One of the most demanding and rewarding books in Western philosophy, foundational for Marx, Nietzsche, Sartre, and Foucault.',
  },
];

export class SeedLibrary {
  /**
   * Assert all 18 seed books into `urn:dagonizer:memory`.
   *
   * Idempotent: removes every existing `?book rdf:type dag:Book` quad
   * from GRAPH_MEMORY first, then re-asserts the full set. One call on
   * mount and one on reset is sufficient; repeated calls do not accumulate
   * duplicates.
   */
  static loadInto(store: MemoryStore): void {
    // Clear GRAPH_MEMORY and re-assert the full seed set (idempotent).
    // Cross-session data lives in per-run state graphs (urn:dagonizer:state:<id>)
    // which are separate named graphs; clearing GRAPH_MEMORY is safe.
    store.clearGraph(GRAPH_MEMORY);
    SeedLibrary.#assertAll(store);
  }

  /** Return all 18 seed books. */
  static all(): readonly SeedBook[] {
    return SEED_BOOKS;
  }

  /**
   * Case-insensitive substring match against title, authors joined, and subjects.
   * Returns up to `limit` entries ranked by descending match count.
   */
  static findByKeywords(query: string, limit = 3): readonly SeedBook[] {
    if (query.trim().length === 0) return [];
    const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 0);

    const scored: Array<{ book: SeedBook; count: number }> = [];
    for (const book of SEED_BOOKS) {
      const haystack = [
        book.title.toLowerCase(),
        book.authors.join(' ').toLowerCase(),
        book.subjects.join(' '),
      ].join(' ');
      let count = 0;
      for (const term of terms) {
        if (haystack.includes(term)) count++;
      }
      if (count > 0) scored.push({ book, count });
    }
    scored.sort((a, b) => b.count - a.count);
    return scored.slice(0, limit).map((s) => s.book);
  }

  /** Look up a seed book by exact ISBN-13 (hyphens optional). */
  static findByIsbn(isbn: string): SeedBook | null {
    const normalised = isbn.replace(/-/g, '');
    for (const book of SEED_BOOKS) {
      if (book.isbn.replace(/-/g, '') === normalised) return book;
    }
    return null;
  }

  // ── Private helpers ────────────────────────────────────────────────────

  static #assertAll(store: MemoryStore): void {
    for (const book of SEED_BOOKS) {
      const subject = MemoryStore.bookIri(book.isbn);
      store.assert(subject, RDF_TYPE,                       DAG_BOOK,                                          GRAPH_MEMORY);
      store.assert(subject, MemoryStore.dagIri('isbn'),     MemoryStore.lit.str(book.isbn),                    GRAPH_MEMORY);
      store.assert(subject, MemoryStore.dagIri('title'),    MemoryStore.lit.str(book.title),                   GRAPH_MEMORY);
      store.assert(subject, MemoryStore.dagIri('firstPublishYear'), MemoryStore.lit.int(book.firstPublishYear), GRAPH_MEMORY);
      store.assert(subject, MemoryStore.dagIri('summary'),  MemoryStore.lit.str(book.summary),                 GRAPH_MEMORY);
      for (const author of book.authors) {
        store.assert(subject, MemoryStore.dagIri('author'), MemoryStore.lit.str(author), GRAPH_MEMORY);
      }
      for (const subject_ of book.subjects) {
        store.assert(subject, MemoryStore.dagIri('subject'), MemoryStore.lit.str(subject_), GRAPH_MEMORY);
      }
    }
  }
}
