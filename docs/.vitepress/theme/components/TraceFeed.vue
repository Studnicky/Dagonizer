<script setup lang="ts">
/**
 * TraceFeed — unified chronological stream of node lifecycle events and
 * logger output.
 *
 * Merges two sources:
 *   • `entries` — node start/end/error events from the ObservedDagonizer
 *     observer (passed down from ArchivistRunner as the `trace` ref).
 *   • `logger`  — ConsoleLogger subscriber (info/warn/result lines).
 *
 * Both are sorted by `ts` so the feed reads as a single timeline even
 * when logger messages arrive between node events. New items animate in
 * from the left.
 */

import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { ConsoleLogger, LogEvent } from '../../../../examples/the-archivist/logger/ConsoleLogger.ts';

interface TraceEntry {
  readonly node: string;
  readonly output?: string;
  readonly ts: number;
  readonly kind: 'start' | 'end' | 'error';
}

/** Discriminated union for the merged feed. */
type FeedItem =
  | { readonly feedKind: 'trace'; readonly ts: number; readonly entry: TraceEntry }
  | { readonly feedKind: 'log';   readonly ts: number; readonly event: LogEvent };

const props = defineProps<{
  entries: readonly TraceEntry[];
  logger: ConsoleLogger;
}>();

/** Live log events pushed by the subscriber. */
const logEvents = ref<LogEvent[]>([...props.logger.history()]);

const logHandler = (event: LogEvent): void => {
  logEvents.value = [...logEvents.value, event];
};

onMounted(() => { props.logger.subscribe(logHandler); });
onBeforeUnmount(() => { props.logger.unsubscribe(logHandler); });

const feed = computed<readonly FeedItem[]>(() => {
  const items: FeedItem[] = [];
  for (const entry of props.entries) {
    items.push({ 'feedKind': 'trace', 'ts': entry.ts, entry });
  }
  for (const event of logEvents.value) {
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
          ? `tf-trace-${item.entry.kind}`
          : `tf-log-${item.event.level}`]"
      >
        <span class="tf-time">{{ timeFor(item.ts) }}</span>

        <!-- Node lifecycle event -->
        <template v-if="item.feedKind === 'trace'">
          <span :class="['tf-kind', `tf-kind-${item.entry.kind}`]">{{ item.entry.kind }}</span>
          <code class="tf-node">{{ item.entry.node }}</code>
          <span v-if="item.entry.output !== undefined" class="tf-output">→ {{ item.entry.output }}</span>
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
  min-height: 220px;
  height: 100%;
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
  display: flex;
  flex-direction: column;
  gap: 0.14rem;
  font-family: var(--vp-font-family-mono);
  font-size: 0.72rem;
}

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

/* Trace node kind badges */
.tf-kind {
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
.tf-kind-start { background: rgba(34, 232, 255, 0.14); color: var(--dagonizer-brand); }
.tf-kind-end   { background: rgba(155, 81, 224, 0.14); color: var(--dagonizer-brand2); }
.tf-kind-error { background: rgba(212, 166, 73, 0.18); color: var(--dagonizer-brand3); }

.tf-node   { color: var(--vp-c-text-1); }
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
