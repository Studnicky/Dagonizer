<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import PanelHeader from './ui/PanelHeader.vue';
import StateSurface from './ui/StateSurface.vue';
import UiMetaText from './ui/UiMetaText.vue';
import UiPaneSurface from './ui/UiPaneSurface.vue';

const props = withDefaults(defineProps<{
  turns: readonly {
    readonly role: string;
    readonly text: string;
    readonly ts: number;
  }[];
  roleLabels?: Readonly<Record<string, string>>;
  rightAlignedRoles?: readonly string[];
  title?: string;
  emptyHint?: string;
}>(), {
  'roleLabels': () => ({
    'visitor': 'You',
    'archivist': 'The Archivist',
  }),
  'rightAlignedRoles': () => ['visitor'],
  'title': 'Conversation',
  'emptyHint': 'Ask the Archivist something to begin.',
});

const listRef = ref<HTMLOListElement | null>(null);
const STICK_THRESHOLD_PX = 80;

watch(
  () => props.turns.length,
  async () => {
    const el = listRef.value;
    if (el === null) return;
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
    <PanelHeader :title="title">
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
        :class="[
          'turn',
          rightAlignedRoles.includes(turn.role) ? 'turn--right' : 'turn--left',
        ]"
      >
        <span class="turn-role">{{ roleLabels[turn.role] ?? turn.role }}</span>
        <p class="turn-text">{{ turn.text }}</p>
      </li>
    </ol>

    <StateSurface v-else kind="empty">
      {{ emptyHint }}
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

.turn--right {
  align-self: flex-end;
  border-left-color: transparent;
  border-right-color: var(--dagonizer-brand3);
  text-align: right;
}

.turn--left {
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

.turn--right .turn-role { color: var(--dagonizer-brand3); }
.turn--left  .turn-role { color: var(--dagonizer-brand); }

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
