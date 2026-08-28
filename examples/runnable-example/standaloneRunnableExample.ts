import { createApp } from 'vue';

import RunnableExampleMount from './RunnableExampleMount.vue';
import {
  standaloneRunnerPropsForExample,
  type RunnableExampleId,
} from './runnableExampleContext.ts';

function currentSearchParams(): URLSearchParams {
  if (typeof window === 'undefined') {
    return new URLSearchParams();
  }
  return new URLSearchParams(window.location.search);
}

export function mountStandaloneRunnableExample(
  example: RunnableExampleId,
  target = '#app',
): void {
  createApp(RunnableExampleMount, {
    example,
    'runnerProps': standaloneRunnerPropsForExample(example, currentSearchParams()),
  }).mount(target);
}
