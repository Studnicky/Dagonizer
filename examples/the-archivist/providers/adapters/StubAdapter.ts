/**
 * StubAdapter — offline canned-responses adapter grounded in the seed memory graph.
 *
 * Ships with the demo so it works without any network or API key. The
 * adapter is constructed with a required `MemoryStore` — `performChat`
 * grounds compose and classify responses in real SeedLibrary titles so
 * stub citations link to actual nodes in the MemoryGraph the visitor is
 * looking at.
 */

import { SeedLibrary } from '../../data/SeedLibrary.js';
import { MemoryStore } from '../../memory/MemoryStore.js';

import { BaseAdapter } from '@noocodex/dagonizer/adapter';
import type { ChatRequest, ChatResponse, ToolCall, ToolDefinition } from '@noocodex/dagonizer/adapter';

export interface StubAdapterOptions {
  readonly memoryStore: MemoryStore;
}

export class StubAdapter extends BaseAdapter {
  readonly #memoryStore: MemoryStore;

  constructor(opts: StubAdapterOptions) {
    super({
      'id': 'stub',
      'displayName': 'Canned responses (no real LLM)',
      // Stub emits deterministic tool calls keyed to query patterns — counts
      // as full tool support for routing purposes even though output is canned.
      'capabilities': { 'toolUse': 'full', 'structuredOutput': true, 'jsonMode': true },
      'maxAttempts': 1,
    });
    this.#memoryStore = opts.memoryStore;
  }

  protected async performChat(request: ChatRequest): Promise<ChatResponse> {
    const lastUser = [...request.messages].reverse().find((m) => m.role === 'user');
    const query = lastUser?.content ?? '';

    if (isExplainToolPrompt(query)) {
      return { 'message': { 'content': cannedToolExplanation(query) }, 'finishReason': 'stop' };
    }

    if (isStarterQueryPrompt(query)) {
      return { 'message': { 'content': starterQuery() }, 'finishReason': 'stop' };
    }

    if (isGreetingPrompt(query)) {
      return { 'message': { 'content': stubGreeting() }, 'finishReason': 'stop' };
    }

    if (isVisitorReplyPrompt(query)) {
      return { 'message': { 'content': stubVisitorReply() }, 'finishReason': 'stop' };
    }

    if (request.tools !== undefined && request.tools.length > 0 && shouldInvokeWebSearch(query)) {
      const calls = toolCallFor(query, request.tools);
      return { 'message': { 'toolCalls': calls }, 'finishReason': 'tool_call' };
    }

    if (request.outputSchema !== undefined) {
      return groundedDecideTools(query, request.tools ?? []);
    }

    return { 'message': { 'content': this.#groundedAnswer(query) }, 'finishReason': 'stop' };
  }

  /**
   * Count live `?book rdf:type dag:Book` triples in the store — the seed
   * library plus any books added during the session. Used to personalise
   * the "memory status" recall response.
   */
  #shelfSize(): number {
    return this.#memoryStore.select({
      'subject':   '?book',
      'predicate': MemoryStore.iri('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
      'object':    MemoryStore.dagIri('Book'),
      'graph':     '?g',
    }).length;
  }

  #groundedAnswer(query: string): string {
    return groundedAnswer(query, this.#shelfSize());
  }
}

// ── Grounded response helpers ──────────────────────────────────────────────
//
// These run when memoryStore is present. They delegate to SeedLibrary so
// responses cite actual book IRIs that appear in the MemoryGraph.

function groundedDecideTools(query: string, tools: readonly ToolDefinition[]): ChatResponse {
  const matches = SeedLibrary.findByKeywords(query, 3);
  const webSearch = tools.find((t) => t.name === 'web_search_books');

  // If we have seed matches and a web_search tool, name them as candidates.
  if (matches.length > 0 && webSearch !== undefined) {
    const visitor = query.split(/visitor question:/iu)[1]?.trim() ?? query.slice(-200);
    // Emit a tool call so the full DAG flow runs against real candidates.
    return {
      'message': {
        'toolCalls': [{
          'id':        `stub-${String(Date.now())}`,
          'name':      webSearch.name,
          'arguments': { 'query': visitor, 'limit': 5 },
        }],
      },
      'finishReason': 'tool_call',
    };
  }

  return { 'message': { 'content': JSON.stringify({ 'tool_calls': [] }) }, 'finishReason': 'stop' };
}

function groundedAnswer(query: string, shelfSize: number): string {
  const q = query.toLowerCase();

  if (q.includes('acknowledge which sources were searched')) {
    const notesMatch = /search notes:\s*([^\n]+)/i.exec(query);
    const hint = notesMatch !== null ? ` (${(notesMatch[1] ?? '').trim().slice(0, 120)})` : '';
    return `I keep ${String(shelfSize)} titles on these shelves and none of them matched your description${hint}. Try a single keyword — an author surname, a year, or one strong image from the book — and I will cast a wider net.`;
  }

  if (q.includes('memory status:')) {
    if (q.includes('no books have been recorded')) {
      return `My shelves currently hold ${String(shelfSize)} title${shelfSize === 1 ? '' : 's'} from the seed library. Ask me about science fiction, philosophy, or a specific author and we'll build from there.`;
    }
    const bookMatch  = /(\d+) distinct book/.exec(q);
    const queryMatch = /(\d+) prior (session|sessions)/.exec(q);
    const titleMatch = /recent titles?: ([^.]+)\./.exec(q);
    const bookCount  = bookMatch  !== null ? bookMatch[1]  : 'several';
    const sessions   = queryMatch !== null ? queryMatch[1] : 'several';
    const titles     = titleMatch !== null ? titleMatch[1] : 'various titles';
    return `These shelves hold ${String(shelfSize)} title${shelfSize === 1 ? '' : 's'} in total. Of those, ${bookCount} ${Number(bookCount) === 1 ? 'book' : 'books'} came up across ${sessions} prior ${Number(sessions) === 1 ? 'session' : 'sessions'}. The most recent include ${titles}.`;
  }

  // Extract the visitor's actual query from the full prompt scaffold.
  const visitorLine = extractVisitorQuery(query);
  const searchFor = visitorLine.length > 0 ? visitorLine : query;
  const matches = SeedLibrary.findByKeywords(searchFor, 3);

  if (matches.length === 0) {
    return "I don't have anything matching that on the shelves — try a title name, an author surname, or a subject keyword and I'll cast a wider net.";
  }

  const [first, second, third] = matches;
  if (first === undefined) {
    return "I don't have anything matching that on the shelves — try a title name, an author surname, or a subject keyword and I'll cast a wider net.";
  }

  const reason = first.subjects.slice(0, 2).join(', ');
  let response = `Of what the shelves remember, ${first.title} by ${first.authors[0] ?? 'unknown'} fits closest — ${reason}.`;

  if (second !== undefined) {
    const reason2 = second.subjects[0] ?? second.summary.split('.')[0] ?? '';
    response += ` You might also consider ${second.title} by ${second.authors[0] ?? 'unknown'} — ${reason2}.`;
  }

  if (third !== undefined) {
    response += ` ${third.title} by ${third.authors[0] ?? 'unknown'} rounds out the shelf on this subject.`;
  }

  return response;
}

/** Pull the visitor's question out of a compound LLM prompt. */
function extractVisitorQuery(prompt: string): string {
  // Prompts from the classify / compose nodes embed the visitor's message.
  const patterns = [
    /visitor(?:'s)? (?:question|message|query)[:\s]+([^\n]+)/iu,
    /visitor said[:\s]+"([^"]+)"/iu,
    /"query"[:\s]+"([^"]+)"/u,
  ];
  for (const re of patterns) {
    const m = re.exec(prompt);
    if (m !== null && m[1] !== undefined && m[1].length > 0) return m[1].trim();
  }
  // Last 200 chars as fallback — likely the actual question.
  return prompt.slice(-200).trim();
}

// ── Original fully-canned helpers ─────────────────────────────────────────

const STARTER_QUERIES: readonly string[] = [
  'Do you have the complete Dune saga by Frank Herbert?',
  'What order should I read The Lord of the Rings?',
  'Which Stephen King novel is the scariest?',
  'Are all the Harry Potter books in stock?',
  'What did Agatha Christie write before Hercule Poirot?',
  'Where should I start with Brandon Sanderson?',
  'Can you tell me about Neil Gaiman\'s mythology books?',
  'What are the major themes in Octavia Butler\'s Kindred?',
  'Is there a reading order for Terry Pratchett\'s Discworld?',
  'Which Ursula Le Guin novel should I read first?',
  'What is Murakami\'s most accessible novel for new readers?',
  'Which Hemingway is a good introduction to his work?',
];

const STUB_GREETINGS: readonly string[] = [
  'Welcome to the shop. The shelves remember everything they hold. What brings you in?',
  'Stay a while. I have a long list of books and a longer one of questions about them.',
  'A reader, then. Tell me what you are looking for, and I will see what the catalog gives up.',
  'The door is always open here. Name a title, an author, or a feeling, and I will look.',
  'Good to see you. The shelves run deep on every subject — where would you like to begin?',
  'Come in. I keep records on almost everything ever printed. What can I find for you?',
  'Every visitor arrives with a question worth answering. What is yours?',
];

const STUB_VISITOR_REPLIES: readonly string[] = [
  "I'm looking for something thoughtful about memory — any suggestions?",
  'What do you have on labyrinths?',
  'A book that feels like winter.',
  "Something by Le Guin I might have missed?",
  'Where should I start with Borges?',
  'Do you have anything about libraries themselves as a subject?',
  'I want something quietly unsettling — not horror, just strange.',
];

const TOOL_EXPLANATIONS: ReadonlyMap<string, string> = new Map([
  ['open-library-scout',  "This tool reaches out to OpenLibrary — a free, open catalog of millions of books — and fetches matching titles based on your search. It matters because it's the backbone of the Archivist's book discovery: no real data, no real answers. For example, if you ask about Piranesi, this scout retrieves Susanna Clarke's novel with its full metadata."],
  ['google-books-scout',  "This tool queries the Google Books API to find book candidates with ratings and review counts. It matters because it adds a second independent source to cross-check OpenLibrary results and surfaces titles with community sentiment. For example, asking for the best-reviewed Hemingway triggers this scout to return rated volumes with star counts attached."],
  ['subject-scout',       "This tool searches OpenLibrary by subject or theme rather than by title or author. It matters because visitors often describe the feeling of a book rather than its name — and subject search catches those cases. For example, asking for something about labyrinths triggers this scout to query the 'labyrinth' subject index directly."],
  ['wikipedia-scout',     "This tool fetches a Wikipedia page summary for any topic the Archivist wants to enrich context on. It matters because some queries need background that the book catalog alone can't provide — historical events, real people, or places. For example, when a visitor asks about a novel set during a real war, this scout pulls the Wikipedia synopsis for grounding."],
  ['recall-context',      "This node queries the persistent memory graph using SPARQL to surface prior visitor intents and recently-seen books from earlier sessions. It matters because it gives the Archivist conversational continuity — remembering past visits so responses feel personal. For example, if you asked about cosmic horror last time, this node surfaces that so the classifier can infer a returning genre preference."],
  ['classify-intent',     "This node sends the visitor's message to the LLM and asks it to label the intent as one of nine categories: lookup-author, find-reviews, describe-book, recommend-similar, recall-memories, search, describe, recommend, or off-topic. It matters because the label routes the query to the right DAG branch. For example, 'what did Le Guin write?' is classified as lookup-author and steered to the author-survey path."],
  ['decide-tools',        "This node asks the LLM to choose which search tools to call given the visitor's query. It matters because not every question needs every scout — calling only the right tools saves time and reduces noise in the candidate pool. For example, for a direct ISBN lookup only the OpenLibrary scout is selected, skipping Google Books and Wikipedia."],
  ['rank-candidates',     "This node asks the LLM to score each candidate book on a 0–1 relevance scale against the visitor's question. It matters because raw search results are unordered — ranking puts the best match first so the final response cites the most relevant titles. For example, ten candidates come in and the LLM scores 'House of Leaves' 0.92 for a query about cosmic architecture."],
  ['merge-candidates',    "This node deduplicates book candidates from all scouts using a canonical ID derived from ISBN-13, ISBN-10, or a title-and-author URN. It matters because the same book can appear in both OpenLibrary and Google Books under slightly different metadata. For example, two copies of The Name of the Rose with different ISBNs are collapsed into one candidate with the richer metadata kept."],
  ['compose-response',    "This node asks the LLM to write the final reply to the visitor in the Archivist's warm librarian voice, grounding every claim in the ranked shortlist. It matters because this is the public face of the system — the prose the visitor actually reads. For example, it produces: 'You might enjoy Piranesi by Susanna Clarke — a hushed novel about a man cataloguing the rooms of an impossible House.'"],
  ['validate-response',   "This node asks the LLM to judge the drafted reply: does it mention a shortlisted title and read as a polite, on-topic response? It matters because it acts as a quality gate — if the draft fails, the pipeline retries the compose step rather than showing a weak answer. For example, a draft that only says 'I'm not sure' scores 'no' and triggers a retry with the full shortlist."],
]);

function isExplainToolPrompt(query: string): boolean {
  return query.includes('You are a librarian explaining a backend tool') && query.includes('Return just the explanation, no preamble.');
}

function cannedToolExplanation(query: string): string {
  for (const [key, explanation] of TOOL_EXPLANATIONS) {
    if (query.includes(`"${key}"`)) return explanation;
  }
  const nameMatch = /The tool is called "([^"]+)"/u.exec(query);
  const name = nameMatch !== null ? nameMatch[1] : 'this component';
  return `${name} is a node in the Archivist DAG that performs a focused step in book discovery or response generation. It matters because each node has a single responsibility, keeping the pipeline modular and easy to test in isolation. For example, it runs whenever the dispatcher reaches that step in the execution graph.`;
}

function isStarterQueryPrompt(query: string): boolean {
  return query.includes('Pick one popular author or series at random');
}

function starterQuery(): string {
  return STARTER_QUERIES[Date.now() % STARTER_QUERIES.length] as string;
}

function isGreetingPrompt(query: string): boolean {
  return query.includes('Write ONE fresh opening greeting for a new visitor');
}

function stubGreeting(): string {
  return STUB_GREETINGS[Date.now() % STUB_GREETINGS.length] as string;
}

function isVisitorReplyPrompt(query: string): boolean {
  return query.includes('Write ONE natural first message the visitor might send in reply');
}

function stubVisitorReply(): string {
  return STUB_VISITOR_REPLIES[Date.now() % STUB_VISITOR_REPLIES.length] as string;
}

function shouldInvokeWebSearch(query: string): boolean {
  // ISBN-13 / ISBN-10 patterns, quoted titles, or "by <author>" hints.
  return (
    /\b97[89]\d{10}\b/u.test(query)
    || /"([^"]{3,})"/u.test(query)
    || /\bby\s+[A-Z][a-z]+/u.test(query)
    || /\bauthor\b|\bisbn\b|\btitle\b/iu.test(query)
  );
}

function toolCallFor(query: string, tools: readonly ToolDefinition[]): ToolCall[] {
  const webSearch = tools.find((t) => t.name === 'web_search_books');
  if (webSearch === undefined) return [];
  // Strip the prompt scaffolding to extract just the visitor question.
  const visitor = query.split(/visitor question:/iu)[1]?.trim() ?? query.slice(-200);
  return [{
    'id':   `stub-${String(Date.now())}`,
    'name': webSearch.name,
    'arguments': { 'query': visitor, 'limit': 5 },
  }];
}

