<script setup lang="ts">
const props = defineProps<{
  kind: 'loading' | 'error' | 'empty';
  message: string;
}>();
</script>

<template>
  <div
    class="dagonizer-viewer-overlay"
    :class="`dagonizer-viewer-overlay--${props.kind}`"
    aria-live="polite"
  >
    <div class="dagonizer-viewer-overlay__panel">
      {{ props.message }}
    </div>
  </div>
</template>
