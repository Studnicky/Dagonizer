<script setup lang="ts">
/**
 * LogStream — live stream of `ConsoleLogger` events.
 *
 * Subscribes on mount, unsubscribes on unmount. Each event is appended
 * to a reactive list; the most recent entry fades in. Levels render
 * with distinct chip colours so info / warn / result are skim-readable.
 */

import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { ConsoleLogger, LogEvent } from '../../../../examples/the-archivist/logger/ConsoleLogger.ts';

const props = defineProps<{ logger: ConsoleLogger }>();

const events = ref<LogEvent[]>([...props.logger.history()]);

const handler = (event: LogEvent): void => {
  events.value = [...events.value, event];
};

onMounted(() => { props.logger.subscribe(handler); });
onBeforeUnmount(() => { props.logger.unsubscribe(handler); });

function timeFor(ts: number): string {
  const d = new Date(ts);
  return d.toTimeString().slice(0, 8);
}
</script>

<template>
  <section class="log-stream">
    <header class="log-header">
      <h4>Logger</h4>
      <span class="log-count">{{ events.length }} {{ events.length === 1 ? 'line' : 'lines' }}</span>
    </header>

    <ol v-if="events.length > 0" class="log-list">
      <li
        v-for="(event, i) in events"
        :key="`${event.ts}-${i}`"
        :class="['log-entry', `log-${event.level}`]"
      >
        <span class="log-time">{{ timeFor(event.ts) }}</span>
        <span class="log-level">{{ event.level }}</span>
        <span class="log-message">{{ event.message }}</span>
      </li>
    </ol>

    <p v-else class="log-empty">No log events yet.</p>
  </section>
</template>

<style scoped>
.log-stream {
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  padding: 0.7rem 0.85rem;
  display: flex;
  flex-direction: column;
  min-height: 220px;
}

.log-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 0.55rem;
}

.log-header h4 {
  margin: 0;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--vp-c-text-3);
}

.log-count {
  font-family: var(--vp-font-family-mono);
  font-size: 0.7rem;
  color: var(--vp-c-text-3);
}

.log-list {
  list-style: none;
  padding: 0;
  margin: 0;
  overflow-y: auto;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 0.18rem;
  font-family: var(--vp-font-family-mono);
  font-size: 0.72rem;
}

.log-entry {
  display: grid;
  grid-template-columns: max-content max-content minmax(0, 1fr);
  gap: 0.45rem;
  align-items: baseline;
  padding: 0.18rem 0.3rem;
  border-radius: 3px;
  animation: log-in 0.2s ease-out;
}

.log-entry:nth-child(odd) { background: var(--vp-c-bg-alt); }

.log-time { color: var(--vp-c-text-3); font-size: 0.66rem; }

.log-level {
  font-size: 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 0.05rem 0.4rem;
  border-radius: 2px;
  min-width: 44px;
  text-align: center;
}

.log-info   .log-level { background: rgba(34, 232, 255, 0.12); color: var(--dagonizer-brand); }
.log-warn   .log-level { background: rgba(212, 166, 73, 0.18); color: var(--dagonizer-brand3); }
.log-result .log-level { background: rgba(155, 81, 224, 0.16); color: var(--dagonizer-brand2); }

.log-message {
  color: var(--vp-c-text-1);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.log-warn .log-message   { color: var(--dagonizer-brand3); }
.log-result .log-message { color: var(--vp-c-text-1); font-weight: 600; }

.log-empty {
  margin: auto 0;
  text-align: center;
  color: var(--vp-c-text-3);
  font-style: italic;
  font-size: 0.78rem;
}

@keyframes log-in {
  from { opacity: 0; transform: translateX(-3px); }
  to   { opacity: 1; transform: translateX(0); }
}
</style>
