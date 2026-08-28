<script setup lang="ts">
import { computed, nextTick, onErrorCaptured, onMounted, ref, shallowRef } from 'vue';
import type { Component } from 'vue';

import {
  clearRunnableExampleContext,
  loadRunnableExampleComponent,
  type RunnableExampleId,
} from './runnableExampleContext.ts';

type RunnableExampleMountState = 'loading' | 'recovering' | 'ready' | 'fatal';

const props = withDefaults(defineProps<{
  example: RunnableExampleId;
  runnerProps?: Readonly<Record<string, unknown>>;
}>(), {
  'runnerProps': () => ({}),
});

const activeRunner = shallowRef<Component | null>(null);
const mountKey = ref(0);
const mountState = ref<RunnableExampleMountState>('loading');
const failureMessage = ref('');
const recoveryAttempted = ref(false);
const startedSuccessfully = ref(false);
const recoveryInFlight = ref(false);
const loadToken = ref(0);

function describeError(error: unknown): string {
  return error instanceof Error && error.message !== ''
    ? error.message
    : String(error);
}

async function mountRunner(): Promise<void> {
  const token = loadToken.value + 1;
  loadToken.value = token;
  mountState.value = recoveryAttempted.value ? 'recovering' : 'loading';
  failureMessage.value = '';

  try {
    activeRunner.value = await loadRunnableExampleComponent(props.example);
    await nextTick();
    if (loadToken.value !== token) return;
    startedSuccessfully.value = true;
    mountState.value = 'ready';
  } catch (error) {
    await recoverOrFail(error);
  }
}

async function recoverOrFail(error: unknown): Promise<void> {
  const message = describeError(error);
  loadToken.value += 1;

  if (startedSuccessfully.value || recoveryAttempted.value) {
    activeRunner.value = null;
    failureMessage.value = message;
    mountState.value = 'fatal';
    return;
  }

  if (recoveryInFlight.value) {
    return;
  }

  recoveryInFlight.value = true;
  recoveryAttempted.value = true;
  activeRunner.value = null;
  failureMessage.value = message;
  mountState.value = 'recovering';

  await clearRunnableExampleContext(props.example);

  mountKey.value += 1;
  recoveryInFlight.value = false;
  await mountRunner();
}

onMounted(() => {
  void mountRunner();
});

onErrorCaptured((error) => {
  void recoverOrFail(error);
  return false;
});

const statusTitle = computed<string>(() => {
  switch (mountState.value) {
    case 'recovering':
      return 'Resetting stored browser context';
    case 'fatal':
      return 'Runnable example failed to start';
    default:
      return 'Loading runnable example';
  }
});

const statusBody = computed<string>(() => {
  switch (mountState.value) {
    case 'recovering':
      return 'The stored session data could not be restored. The old browser state is being cleared and a fresh session is starting.';
    case 'fatal':
      return failureMessage.value === ''
        ? 'The example still failed after browser-state recovery.'
        : `The example still failed after browser-state recovery: ${failureMessage.value}`;
    default:
      return 'Preparing the shared Vue mount for this example.';
  }
});
</script>

<template>
  <div
    class="runnable-example-island"
    :data-runnable-example="example"
    :data-runnable-example-state="mountState"
  >
    <component
      :is="activeRunner"
      v-if="activeRunner !== null && mountState !== 'fatal'"
      :key="mountKey"
      v-bind="runnerProps"
    />

    <div
      v-if="mountState !== 'ready'"
      class="runnable-example-island__status"
      role="status"
      :aria-live="mountState === 'fatal' ? 'assertive' : 'polite'"
    >
      <p class="runnable-example-island__eyebrow">Runnable Example</p>
      <h3 class="runnable-example-island__title">{{ statusTitle }}</h3>
      <p class="runnable-example-island__body">{{ statusBody }}</p>
    </div>
  </div>
</template>

<style scoped>
.runnable-example-island {
  display: grid;
  gap: 1rem;
}

.runnable-example-island__status {
  min-height: 12rem;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 1.5rem;
  background:
    linear-gradient(160deg, rgba(8, 47, 73, 0.26), rgba(15, 23, 42, 0.88)),
    rgba(2, 6, 23, 0.82);
  box-shadow: 0 24px 72px -40px rgba(15, 23, 42, 0.95);
  padding: 1.5rem;
}

.runnable-example-island__eyebrow {
  margin: 0 0 0.65rem 0;
  color: rgba(125, 211, 252, 0.9);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
}

.runnable-example-island__title {
  margin: 0;
  color: rgb(241, 245, 249);
  font-size: 1.1rem;
  font-weight: 600;
}

.runnable-example-island__body {
  margin: 0.85rem 0 0 0;
  max-width: 42rem;
  color: rgba(203, 213, 225, 0.9);
  font-size: 0.94rem;
  line-height: 1.65;
}
</style>
