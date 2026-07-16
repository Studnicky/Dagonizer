import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://studnicky.github.io',
  base: '/Dagonizer/',
  integrations: [
    vue({
      appEntrypoint: '/src/primevue-app.ts'
    }),
    mdx(),
    sitemap()
  ],
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      mainFields: ['module', 'browser', 'main']
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) {
              return undefined;
            }

            if (id.includes('@mlc-ai/web-llm')) {
              return 'vendor-webllm';
            }

            if (
              id.includes('@huggingface/transformers') ||
              id.includes('@tensorflow-models/universal-sentence-encoder') ||
              id.includes('@tensorflow/') ||
              id.includes('onnxruntime')
            ) {
              return 'vendor-ml';
            }

            if (id.includes('cytoscape') || id.includes('cose-bilkent')) {
              return 'vendor-cytoscape';
            }

            if (id.includes('mermaid') || id.includes('katex') || id.includes('dagre')) {
              return 'vendor-diagrams';
            }

            if (
              id.includes('@luma.gl') ||
              id.includes('@probe.gl') ||
              id.includes('webgl-') ||
              id.includes('mjolnir')
            ) {
              return 'vendor-webgl';
            }

            if (id.includes('primevue') || id.includes('@primeuix') || id.includes('primeicons')) {
              return 'vendor-primevue';
            }

            return undefined;
          }
        }
      }
    },
    ssr: {
      noExternal: ['primevue']
    }
  }
});
