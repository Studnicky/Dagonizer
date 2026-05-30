<script setup lang="ts">
/**
 * CheckpointControls — Save / Resume checkpoint buttons for the conversation header.
 *
 * "Save checkpoint" captures the execution result via `Checkpoint.from()` and
 * stores the JSON under `dagonizer-archivist-checkpoint` in localStorage.
 *
 * "Resume" is surfaced when a stored checkpoint exists. It emits `resume`
 * with the stored JSON so the parent can call:
 *   Checkpoint.restore(data, (snap) => ArchivistState.restore(snap))
 *   dispatcher.resume(dagName, state, cursor)
 *
 * The parent must emit `save-checkpoint` (with the latest ExecutionResult) to
 * trigger a save; this component does not own dispatcher state.
 */

import { onMounted, ref } from 'vue';

const STORAGE_KEY = 'dagonizer-archivist-checkpoint';

const props = defineProps<{
  /** The node name at which the last checkpoint was captured, or null. */
  checkpointNode: string | null;
  /** True while a run is in progress — disables both buttons during live execution. */
  running: boolean;
  /** True when a valid checkpoint exists in localStorage. */
  hasCheckpoint: boolean;
}>();

const emit = defineEmits<{
  (event: 'save'): void;
  (event: 'resume'): void;
}>();

const stored = ref(props.hasCheckpoint);

onMounted(() => {
  stored.value = typeof localStorage !== 'undefined'
    ? localStorage.getItem(STORAGE_KEY) !== null
    : false;
});

function onSave(): void {
  emit('save');
}

function onResume(): void {
  emit('resume');
}
</script>

<template>
  <div class="ckpt-controls">
    <button
      type="button"
      class="ckpt-btn ckpt-save"
      :disabled="running || checkpointNode === null"
      :title="checkpointNode !== null ? `Save checkpoint at ${checkpointNode}` : 'No checkpoint available. Run the Archivist first.'"
      @click="onSave"
    >
      <span aria-hidden="true">&#9632;</span> checkpoint
    </button>

    <button
      v-if="hasCheckpoint"
      type="button"
      class="ckpt-btn ckpt-resume"
      :disabled="running"
      title="Resume from saved checkpoint"
      @click="onResume"
    >
      <span aria-hidden="true">&#9654;</span> resume
    </button>

    <span v-if="checkpointNode !== null" class="ckpt-label">
      saved at <code>{{ checkpointNode }}</code>
    </span>
  </div>
</template>

<style scoped>
.ckpt-controls {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex-wrap: wrap;
}

.ckpt-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.2rem 0.55rem;
  border-radius: 4px;
  font-family: var(--vp-font-family-mono);
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  cursor: pointer;
  transition: filter 0.12s ease;
}

.ckpt-btn[disabled] { opacity: 0.4; cursor: not-allowed; }

.ckpt-save {
  background: rgba(155, 81, 224, 0.12);
  color: var(--dagonizer-brand2);
  border: 1px solid rgba(155, 81, 224, 0.3);
}

.ckpt-save:hover:not([disabled]) { filter: brightness(1.15); }

.ckpt-resume {
  background: rgba(34, 232, 255, 0.12);
  color: var(--dagonizer-brand);
  border: 1px solid rgba(34, 232, 255, 0.3);
}

.ckpt-resume:hover:not([disabled]) { filter: brightness(1.15); }

.ckpt-label {
  font-family: var(--vp-font-family-mono);
  font-size: 0.68rem;
  color: var(--vp-c-text-3);
}

.ckpt-label code {
  font-size: 0.68rem;
  color: var(--dagonizer-brand2);
  background: rgba(155, 81, 224, 0.08);
  padding: 0.05rem 0.25rem;
  border-radius: 2px;
}
</style>
