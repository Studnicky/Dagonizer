<script setup lang="ts">
/**
 * TraceFeed: unified chronological stream of node lifecycle events and
 * logger output.
 *
 * Merges two sources:
 *   • `entries`: node start/end/error events from the ObservedDagonizer
 *     observer (passed down from ArchivistRunner as the `trace` ref).
 *   • `logEvents`: the reactive `DomConsoleLogger.events` array (info/warn/
 *     result lines), owned by ArchivistRunner and appended to by the logger's
 *     `onEmit` override — no subscribe callback.
 *
 * Both are sorted by `ts` so the feed reads as a single timeline even
 * when logger messages arrive between node events. New items animate in
 * from the left.
 */

import { computed } from 'vue';
import type { LogEvent } from '../../../../examples/the-archivist/logger/ConsoleLogger.ts';

type TraceEntry =
  | { readonly variant: 'start'; readonly node: string; readonly ts: number }
  | { readonly variant: 'end';   readonly node: string; readonly ts: number; readonly output: string | null }
  | { readonly variant: 'error'; readonly node: string; readonly ts: number; readonly message: string };

/** Discriminated union for the merged feed. */
type FeedItem =
  | { readonly feedKind: 'trace'; readonly ts: number; readonly entry: TraceEntry }
  | { readonly feedKind: 'log';   readonly ts: number; readonly event: LogEvent };

const props = defineProps<{
  entries: readonly TraceEntry[];
  logEvents: readonly LogEvent[];
}>();

const emit = defineEmits<{
  (event: 'node-click', name: string): void;
}>();

const feed = computed<readonly FeedItem[]>(() => {
  const items: FeedItem[] = [];
  for (const entry of props.entries) {
    items.push({ 'feedKind': 'trace', 'ts': entry.ts, entry });
  }
  for (const event of props.logEvents) {
    items.push({ 'feedKind': 'log', 'ts': event.ts, event });
  }
  items.sort((a, b) => a.ts - b.ts);
  return items;
});

function timeFor(ts: number): string {
  const d = new Date(ts);
  return d.toTimeString().slice(0, 8);
}
</script>

<template>
  <section class="trace-feed">
    <header class="tf-header">
      <h4>Trace</h4>
      <span class="tf-count">{{ feed.length }} events</span>
    </header>

    <ol v-if="feed.length > 0" class="tf-list">
      <li
        v-for="(item, i) in feed"
        :key="`${item.ts}-${i}`"
        :class="['tf-entry', item.feedKind === 'trace'
          ? `tf-trace-${item.entry.variant}`
          : `tf-log-${item.event.level}`]"
      >
        <span class="tf-time">{{ timeFor(item.ts) }}</span>

        <!-- Node lifecycle event -->
        <template v-if="item.feedKind === 'trace'">
          <span :class="['tf-variant', `tf-variant-${item.entry.variant}`]">{{ item.entry.variant }}</span>
          <code class="tf-node tf-node-clickable" role="button" tabindex="0" @click="emit('node-click', item.entry.node)" @keydown.enter="emit('node-click', item.entry.node)">{{ item.entry.node }}</code>
          <span v-if="item.entry.variant === 'end' && item.entry.output !== null" class="tf-output">→ {{ item.entry.output }}</span>
          <span v-else-if="item.entry.variant === 'error'" class="tf-error-message">{{ item.entry.message }}</span>
          <span v-else class="tf-output"></span>
        </template>

        <!-- Logger line -->
        <template v-else>
          <span :class="['tf-level', `tf-level-${item.event.level}`]">{{ item.event.level }}</span>
          <span class="tf-message">{{ item.event.message }}</span>
        </template>
      </li>
    </ol>

    <p v-else class="tf-empty">No events yet. Start a run to see the trace.</p>
  </section>
</template>

<style scoped>
.trace-feed {
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  padding: 0.7rem 0.85rem;
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.tf-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 0.55rem;
  flex-shrink: 0;
}

.tf-header h4 {
  margin: 0;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--vp-c-text-3);
}

.tf-count {
  font-family: var(--vp-font-family-mono);
  font-size: 0.7rem;
  color: var(--vp-c-text-3);
}

.tf-list {
  list-style: none;
  padding: 0;
  margin: 0;
  overflow-y: auto;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.14rem;
  font-family: var(--vp-font-family-mono);
  font-size: 0.72rem;
  scrollbar-width: thin;
  scrollbar-color: var(--vp-c-divider) transparent;
}

.tf-list::-webkit-scrollbar { width: 6px; }
.tf-list::-webkit-scrollbar-track { background: transparent; }
.tf-list::-webkit-scrollbar-thumb { background: var(--vp-c-divider); border-radius: 3px; }

.tf-entry {
  display: grid;
  grid-template-columns: max-content max-content minmax(0, 1fr);
  gap: 0.45rem;
  align-items: baseline;
  padding: 0.18rem 0.3rem;
  border-radius: 3px;
  animation: tf-in 0.2s ease-out;
}

/* Logger rows get a subtle striping so they read apart from trace rows. */
.tf-entry:has(.tf-level) {
  background: var(--vp-c-bg-alt);
}

.tf-entry:nth-child(odd):has(.tf-level) {
  background: transparent;
}

.tf-time {
  color: var(--vp-c-text-3);
  font-size: 0.66rem;
}

/* Trace node variant badges */
.tf-variant {
  font-size: 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 0.05rem 0.35rem;
  border-radius: 2px;
  background: var(--vp-c-bg-alt);
  color: var(--vp-c-text-3);
  min-width: 38px;
  text-align: center;
}
.tf-variant-start { background: rgba(34, 232, 255, 0.14); color: var(--dagonizer-brand); }
.tf-variant-end   { background: rgba(155, 81, 224, 0.14); color: var(--dagonizer-brand2); }
.tf-variant-error { background: rgba(212, 166, 73, 0.18); color: var(--dagonizer-brand3); }

.tf-node    { color: var(--vp-c-text-1); }
.tf-error-message {
  color: var(--vp-c-text-3);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  font-style: italic;
}
.tf-node-clickable {
  cursor: pointer;
  text-decoration: underline dotted var(--dagonizer-brand2);
  text-underline-offset: 2px;
}
.tf-node-clickable:hover { color: var(--dagonizer-brand2); }
.tf-output { color: var(--vp-c-text-3); }

/* Log level badges */
.tf-level {
  font-size: 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 0.05rem 0.4rem;
  border-radius: 2px;
  min-width: 44px;
  text-align: center;
}
.tf-level-info   { background: rgba(34, 232, 255, 0.12); color: var(--dagonizer-brand); }
.tf-level-warn   { background: rgba(212, 166, 73, 0.18); color: var(--dagonizer-brand3); }
.tf-level-result { background: rgba(155, 81, 224, 0.16); color: var(--dagonizer-brand2); }

.tf-message {
  color: var(--vp-c-text-1);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.tf-log-warn   .tf-message { color: var(--dagonizer-brand3); }
.tf-log-result .tf-message { color: var(--vp-c-text-1); font-weight: 600; }

.tf-empty {
  margin: auto 0;
  text-align: center;
  color: var(--vp-c-text-3);
  font-style: italic;
  font-size: 0.78rem;
}

@keyframes tf-in {
  from { opacity: 0; transform: translateX(-4px); }
  to   { opacity: 1; transform: translateX(0); }
}
</style>
