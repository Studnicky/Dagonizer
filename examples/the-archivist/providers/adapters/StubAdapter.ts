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
