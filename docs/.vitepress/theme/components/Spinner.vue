<script setup lang="ts">
/**
 * Spinner: a circular loading ring, absolutely centred within its parent.
 *
 * The ring is always a true circle regardless of the parent's aspect ratio.
 * Fixed square (size × size) positioned via negative-half-size margins
 * rather than `inset`, which would stretch it into an oval on non-square
 * buttons.
 */

const props = withDefaults(defineProps<{
  /** Diameter of the ring in pixels (default 20). */
  size?: number;
}>(), {
  size: 20,
});

const half = props.size / 2;
</script>

<template>
  <span
    class="spinner-ring"
    :style="{
      width:       `${size}px`,
      height:      `${size}px`,
      marginTop:   `-${half}px`,
      marginLeft:  `-${half}px`,
    }"
    aria-hidden="true"
  ></span>
</template>

<style scoped>
.spinner-ring {
  position: absolute;
  top: 50%;
  left: 50%;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.18);
  border-top-color: rgba(255, 255, 255, 0.9);
  animation: spinner-rotate 0.9s linear infinite;
  pointer-events: none;
}

@keyframes spinner-rotate {
  to { transform: rotate(360deg); }
}
</style>
