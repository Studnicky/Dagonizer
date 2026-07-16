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
import PanelHeader from './ui/PanelHeader.vue';
import StateSurface from './ui/StateSurface.vue';
import UiMetaText from './ui/UiMetaText.vue';
import UiPaneSurface from './ui/UiPaneSurface.vue';

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

function cleanTurnText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if (
    (first === '"' && last === '"') ||
    (first === "'" && last === "'") ||
    (first === '\u201c' && last === '\u201d') ||
    (first === '\u2018' && last === '\u2019')
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

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
  <UiPaneSurface class="conversation" fill-height padding="lg">
    <PanelHeader title="Conversation">
      <template #meta>
        <UiMetaText v-if="turns.length > 0">
          {{ turns.length }} {{ turns.length === 1 ? 'turn' : 'turns' }}
        </UiMetaText>
      </template>
    </PanelHeader>

    <ol v-if="turns.length > 0" ref="listRef" class="conversation-list">
      <li
        v-for="turn in turns"
        :key="turn.ts"
        :class="['turn', `turn-${turn.role}`]"
      >
        <span class="turn-role">{{ turn.role === 'visitor' ? 'You' : 'The Archivist' }}</span>
        <p class="turn-text">{{ cleanTurnText(turn.text) }}</p>
      </li>
    </ol>

    <StateSurface v-else kind="empty">
      {{ emptyHint ?? 'Ask the Archivist something to begin.' }}
    </StateSurface>
  </UiPaneSurface>
</template>

<style scoped>
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
  width: fit-content;
  max-width: min(82%, 38rem);
  padding: 0.5rem 0.65rem;
  border-radius: 4px;
  border-left: 3px solid transparent;
  border-right: 3px solid transparent;
  background: var(--vp-c-bg-alt);
  animation: turn-in 0.25s ease-out;
}

.turn-visitor {
  align-self: flex-end;
  border-left-color: transparent;
  border-right-color: var(--dagonizer-brand3);
  text-align: right;
}

.turn-archivist {
  align-self: flex-start;
  border-left-color: var(--dagonizer-brand);
  text-align: left;
}

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

@keyframes turn-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
</style>
