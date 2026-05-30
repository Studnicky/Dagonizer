<script setup lang="ts">
/**
 * Conversation: visitor/archivist turn history.
 *
 * Pure presentational. Renders the chronological transcript; styling
 * differentiates the visitor (gold-ochre) from the Archivist (teal).
 *
 * Auto-scroll: when a new turn arrives, the list scrolls its newest row
 * into view. We watch `turns.length` (cheap signal) rather than the
 * array contents, and we only auto-scroll when the visitor was already
 * looking at the bottom (or close to it). If they have scrolled UP to
 * re-read an earlier turn, we respect that and leave the camera alone;
 * the same "user gesture" principle that pauses the DAG auto-follow.
 */

import { nextTick, ref, watch } from 'vue';

interface Turn {
  readonly role: 'visitor' | 'archivist';
  readonly text: string;
  readonly ts: number;
}

const props = defineProps<{
  turns: readonly Turn[];
  emptyHint?: string;
}>();

const listRef = ref<HTMLOListElement | null>(null);
/** Pixels from the bottom within which we consider the user "at the bottom". */
const STICK_THRESHOLD_PX = 80;

watch(
  () => props.turns.length,
  async () => {
    const el = listRef.value;
    if (el === null) return;
    // Was the user near the bottom before the new turn rendered? If so,
    // stick to the bottom. Otherwise leave them where they are.
    const wasAtBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) < STICK_THRESHOLD_PX;
    await nextTick();
    if (wasAtBottom) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  },
);
</script>

<template>
  <section class="conversation">
    <header class="conversation-header">
      <h4>Conversation</h4>
      <span v-if="turns.length > 0" class="conversation-count">
        {{ turns.length }} {{ turns.length === 1 ? 'turn' : 'turns' }}
      </span>
    </header>

    <ol v-if="turns.length > 0" ref="listRef" class="conversation-list">
      <li
        v-for="turn in turns"
        :key="turn.ts"
        :class="['turn', `turn-${turn.role}`]"
      >
        <span class="turn-role">{{ turn.role === 'visitor' ? 'You' : 'The Archivist' }}</span>
        <p class="turn-text">{{ turn.text }}</p>
      </li>
    </ol>

    <p v-else class="conversation-empty">
      {{ emptyHint ?? 'Ask the Archivist something to begin.' }}
    </p>
  </section>
</template>

<style scoped>
.conversation {
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  padding: 0.8rem 0.9rem;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.conversation-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 0.6rem;
}

.conversation h4 {
  margin: 0;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--vp-c-text-3);
}

.conversation-count {
  font-family: var(--vp-font-family-mono);
  font-size: 0.7rem;
  color: var(--vp-c-text-3);
}

.conversation-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  overflow-y: auto;
  flex: 1 1 auto;
  min-height: 0;
  scrollbar-width: thin;
  scrollbar-color: var(--vp-c-divider) transparent;
}

.conversation-list::-webkit-scrollbar { width: 6px; }
.conversation-list::-webkit-scrollbar-track { background: transparent; }
.conversation-list::-webkit-scrollbar-thumb { background: var(--vp-c-divider); border-radius: 3px; }

.turn {
  padding: 0.5rem 0.65rem;
  border-radius: 4px;
  border-left: 3px solid transparent;
  background: var(--vp-c-bg-alt);
  animation: turn-in 0.25s ease-out;
}

.turn-visitor   { border-left-color: var(--dagonizer-brand3); }
.turn-archivist { border-left-color: var(--dagonizer-brand); }

.turn-role {
  display: block;
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: 0.2rem;
}

.turn-visitor   .turn-role { color: var(--dagonizer-brand3); }
.turn-archivist .turn-role { color: var(--dagonizer-brand); }

.turn-text {
  margin: 0;
  color: var(--vp-c-text-1);
  line-height: 1.45;
  font-size: 0.92rem;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.conversation-empty {
  margin: auto 0;
  color: var(--vp-c-text-3);
  font-style: italic;
  text-align: center;
}

@keyframes turn-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
</style>
