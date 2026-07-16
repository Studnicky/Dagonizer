<script setup lang="ts">
import { computed } from 'vue';

import { DpadMachine } from '../../../../../packages/dagonizer/src/viz/DpadMachine.ts';

const props = withDefaults(defineProps<{
  machine: DpadMachine;
}>(), {});

const state = computed(() => props.machine.state());

function onPress(action: 'zoom-in' | 'pan-up' | 'zoom-out' | 'pan-left' | 'centre' | 'pan-right' | 'expand' | 'close' | 'pan-down' | 'fit'): void {
  void props.machine.press(action);
}
</script>

<template>
  <div class="dagonizer-dpad-wrap" aria-label="Graph navigation controls">
    <aside v-if="state.zoomLevel !== null" class="dagonizer-dpad-hud" aria-live="polite">
      <span class="dagonizer-dpad-hud-level">{{ state.zoomText }}</span>
      <span v-if="state.hint !== null" class="dagonizer-dpad-hud-hint">{{ state.hint }}</span>
    </aside>

    <div class="dagonizer-dpad" aria-label="Navigation D-pad">
      <button
        v-for="item in state.items"
        :key="item.action"
        class="dagonizer-dpad-btn"
        :class="{ 'dagonizer-dpad-btn--disabled': item.disabled }"
        :disabled="item.disabled"
        :title="item.title"
        :aria-label="item.title"
        @click="onPress(item.action)"
      >{{ item.label }}</button>
    </div>
  </div>
</template>
