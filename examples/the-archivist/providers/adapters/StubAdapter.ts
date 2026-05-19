/**
 * StubAdapter — offline canned-responses adapter.
 *
 * Always available; ships with the demo so it works without any
 * network or API key. Implements `chat()` by routing the request to
 * pattern-matchers — the last user message is inspected and a canned
 * response is returned. Tool calls are emitted when the visitor names
 * a specific title / author / ISBN (regex match against the message),
 * otherwise the adapter returns prose.
 */

import { BaseAdapter } from './BaseAdapter.ts';
import type { ChatRequest, ChatResponse, ToolCall, ToolDefinition } from './LlmAdapter.ts';

export class StubAdapter extends BaseAdapter {
  constructor() {
    super({ 'id': 'stub', 'displayName': 'Canned responses (offline stub)', 'maxAttempts': 1 });
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
      // Hand back a minimal JSON shape that matches the schema for the
      // tool-decision flow — empty tool_calls array means "no tool".
      return { 'message': { 'content': JSON.stringify({ 'tool_calls': [] }) }, 'finishReason': 'stop' };
    }

    return { 'message': { 'content': cannedAnswer(query) }, 'finishReason': 'stop' };
  }
}

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

function cannedAnswer(query: string): string {
  const q = query.toLowerCase();

  // Empty-response branch — detect the ownTheGap directive injected by
  // prompts.composeEmptyResponse. Extract the search notes if present.
  if (q.includes('acknowledge which sources were searched')) {
    const notesMatch = /search notes:\s*([^\n]+)/i.exec(query);
    const hint = notesMatch !== null ? ` (${notesMatch[1].trim().slice(0, 120)})` : '';
    return `Stay a while and listen — I searched OpenLibrary, Google Books, the subject index, and Wikipedia, but nothing came back for your description${hint}. The combination may be quite specific. Try a single keyword — the author name alone, or one strong image from the book — and I will cast a wider net.`;
  }

  // Memory-recall branch — detect the digest marker injected by prompts.composeMemoryRecall.
  if (q.includes('memory status:')) {
    if (q.includes('no books have been recorded')) {
      return "Stay a while and listen! My shelves are fresh for you — nothing recorded yet. Ask me about a title, author, or topic and we'll build up a history together.";
    }
    // Extract counts from the digest block for a verifiable stub response.
    const bookMatch  = /(\d+) distinct book/.exec(q);
    const queryMatch = /(\d+) prior (session|sessions)/.exec(q);
    const titleMatch = /recent titles?: ([^.]+)\./.exec(q);
    const bookCount  = bookMatch  !== null ? bookMatch[1]  : 'several';
    const sessions   = queryMatch !== null ? queryMatch[1] : 'several';
    const titles     = titleMatch !== null ? titleMatch[1] : 'various titles';
    return `Stay a while and listen! I have looked up ${bookCount} book${bookCount === '1' ? '' : 's'} across ${sessions} ${Number(sessions) === 1 ? 'session' : 'sessions'}. The most recent include ${titles}. Ask me about any of them, or let's explore something new.`;
  }

  if (q.includes('house') || q.includes('library') || q.includes('labyrinth')) {
    return 'Try "Piranesi" by Susanna Clarke — a quiet, cosmic novel about a man living in an endless House.';
  }
  if (q.includes('mystery') || q.includes('detective')) {
    return 'Consider "The Library at Mount Char" by Scott Hawkins — strange, dark, modern myth-mystery.';
  }
  return 'I can help with searches, descriptions, and recommendations — tell me what kind of book you\'re after.';
}
