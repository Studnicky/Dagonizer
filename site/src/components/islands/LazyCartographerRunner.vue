<script setup lang="ts">
import { defineAsyncComponent } from 'vue';

const CartographerRunner = defineAsyncComponent(
  () => import('../../../../examples/the-cartographer/app/CartographerRunner.vue')
);
</script>

<template>
  <CartographerRunner />
</template>
